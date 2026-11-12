import os
import time
from threading import Lock
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
import requests
from flask import Flask, jsonify, render_template, abort

LONDON = ZoneInfo('Europe/London')
UTC = timezone.utc
SOURCES = ('buses', 'tube', 'carbon', 'trains')
COLOURS = dict(zip(['Bakerloo','Central','Circle','District','Hammersmith & City','Jubilee','Metropolitan','Northern','Piccadilly','Victoria','Waterloo & City'], ['#ae6118','#dc241f','#f3ce0f','#00782a','#f4a9be','#868f98','#751056','#000000','#0019a8','#00a0e2','#76d0a3']))

def now():
    return datetime.now(UTC)

def parse_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def bus_rows(raw, current=None):
    current = current or now()
    result = []
    if not isinstance(raw, list):
        raise ValueError('Invalid bus response')
    for b in raw:
        arrival = parse_time(b['expectedArrival']) if b.get('expectedArrival') else current + timedelta(seconds=float(b['timeToStation']))
        if arrival >= current:
            result.append(dict(line=b.get('lineName', '—'), destination=b.get('destinationName', 'Unknown'), arrival=arrival.isoformat()))
    return sorted(result, key=lambda b: parse_time(b['arrival']))[:8]

def train_time(value, reference):
    hour, minute = map(int, value.split(':'))
    local = reference.astimezone(LONDON)
    # Choose the nearest service date; avoids turning late services into tomorrow's trains.
    candidates = [datetime.combine(local.date()+timedelta(days=d), datetime.min.time(), LONDON).replace(hour=hour, minute=minute) for d in (-1,0,1)]
    return min(candidates, key=lambda d: abs(d.timestamp()-reference.timestamp())).astimezone(UTC).isoformat()

def filter_trains(rows, limit, reference=None):
    reference = reference or now()
    grouped = {'1': [], '2': []}
    for row in rows:
        platform = str(row.get('platform', '')).strip()
        if platform not in grouped:
            continue
        row = dict(row)
        value = row['etd'] if ':' in row.get('etd','') else row['std']
        row['arrival'] = train_time(value, reference)
        grouped[platform].append(row)
    for platform in grouped:
        grouped[platform] = sorted(grouped[platform], key=lambda r: r['arrival'])[:limit]
    return grouped

class Cache:
    def __init__(self, fetch, interval, clock=time.monotonic):
        self.fetch, self.interval, self.clock = fetch, interval, clock
        self.lock = Lock()
        self.checked = None
        self.data = None
        self.updated = None
        self.error = False
    def get(self):
        with self.lock:
            tick = self.clock()
            if self.checked is None or tick-self.checked >= self.interval:
                try:
                    data = self.fetch()
                    self.data, self.updated, self.error = data, now().isoformat(), False
                except Exception:
                    # Never expose upstream exception text, URLs or credentials.
                    self.error = True
                self.checked = self.clock()
            state = 'stale' if self.error and self.updated else 'unavailable' if self.error else 'ok'
            return dict(state=state, data=self.data, last_successful_update=self.updated, refresh_seconds=self.interval, fixture=os.getenv('DEVELOPMENT_FIXTURES') == '1')

class Upstream:
    def __init__(self):
        self.headers = {'Ocp-Apim-Subscription-Key': os.environ['TFL_SUBSCRIPTION_KEY']} if os.getenv('TFL_SUBSCRIPTION_KEY') else {}
    def json(self, url, tfl=False):
        response = requests.get(url, headers=self.headers if tfl else {}, timeout=12)
        response.raise_for_status()
        return response.json()
    def buses(self):
        stop = os.getenv('BUS_STOP_ID','')
        if not stop:
            raise ValueError('BUS_STOP_ID required')
        return bus_rows(self.json(f'https://api.tfl.gov.uk/StopPoint/{requests.utils.quote(stop, safe="")}/Arrivals', True))
    def tube(self):
        raw = self.json('https://api.tfl.gov.uk/Line/Mode/tube/Status', True)
        if not isinstance(raw, list) or not raw:
            raise ValueError('Invalid Tube response')
        result = []
        for line in raw:
            statuses = line['lineStatuses']
            if not statuses:
                raise ValueError('Missing line status')
            disrupted = [s for s in statuses if s['statusSeverity'] != 10]
            selected = disrupted or statuses
            status = ' / '.join(dict.fromkeys(s['statusSeverityDescription'] for s in selected))
            severity = 'good' if not disrupted else 'major' if any(s['statusSeverity'] <= 6 for s in disrupted) else 'warn'
            result.append(dict(name=line['name'], status=status, severity=severity, color=COLOURS.get(line['name'],'#3f3f46'), reason='\n\n'.join(s.get('reason','') for s in selected)))
        return sorted(result, key=lambda r: {'major':0,'warn':1,'good':2}[r['severity']])
    def carbon(self):
        today = now().astimezone(LONDON).date()
        start = datetime.combine(today, datetime.min.time(), LONDON).astimezone(UTC)
        end = datetime.combine(today+timedelta(days=2), datetime.min.time(), LONDON).astimezone(UTC)
        data = self.json(f'https://api.carbonintensity.org.uk/intensity/{start.strftime("%Y-%m-%dT%H:%MZ")}/{end.strftime("%Y-%m-%dT%H:%MZ")}')['data']
        if not isinstance(data,list) or not data:
            raise ValueError('Missing carbon forecast')
        for p in data:
            float(p['intensity']['forecast'])
            parse_time(p['from'])
            parse_time(p['to'])
        return [p for p in data if start <= parse_time(p['from']) < end]
    def trains(self):
        token = os.getenv('NATIONAL_RAIL_TOKEN')
        if not token:
            raise ValueError('NATIONAL_RAIL_TOKEN required')
        station = escape(os.getenv('STATION_CODE','HNH'))
        rows = int(os.getenv('TRAIN_FETCH_ROWS','150'))
        body = f'''<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types" xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/"><soap:Header><typ:AccessToken><typ:TokenValue>{escape(token)}</typ:TokenValue></typ:AccessToken></soap:Header><soap:Body><ldb:GetDepartureBoardRequest><ldb:numRows>{rows}</ldb:numRows><ldb:crs>{station}</ldb:crs><ldb:timeWindow>120</ldb:timeWindow></ldb:GetDepartureBoardRequest></soap:Body></soap:Envelope>'''
        response = requests.post('https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb9.asmx', data=body.encode(), headers={'Content-Type':'application/soap+xml; charset=utf-8'}, timeout=12)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        for el in root.iter():
            el.tag = el.tag.split('}')[-1]
        board = root.find('.//GetStationBoardResult')
        if board is None or root.find('.//Fault') is not None:
            raise ValueError('Invalid rail response')
        services = []
        for svc in board.findall('./trainServices/service'):
            get = lambda name: svc.findtext(name, '')
            destinations = [el.text or '' for el in svc.findall('./destination/location/locationName')]
            services.append(dict(std=get('std'), etd=get('etd'), platform=get('platform'), destination=' / '.join(destinations) or 'Unknown', operatorCode=get('operatorCode')))
        reference = parse_time(board.findtext('generatedAt')) if board.findtext('generatedAt') else now()
        return filter_trains(services, int(os.getenv('TRAIN_ROW_LIMIT','4')), reference)

def create_app(fetchers=None):
    app = Flask(__name__)
    upstream = Upstream()
    if fetchers is None:
        if os.getenv('DEVELOPMENT_FIXTURES') == '1':
            from fixtures import fetchers as fixtures
            fetchers = fixtures()
        else:
            fetchers = {name:getattr(upstream,name) for name in SOURCES}
    caches = {name:Cache(fetchers[name], max(5,int(os.getenv(name.upper()+'_REFRESH_SECONDS', '1800' if name=='carbon' else '60')))) for name in SOURCES}
    app.extensions['source_caches'] = caches
    @app.get('/')
    def index():
        return render_template('index.html')
    @app.get('/health')
    def health():
        return jsonify(status='ok')
    @app.get('/api/<source>')
    def api(source):
        if source not in caches:
            abort(404)
        result = caches[source].get()
        response = jsonify(result)
        response.status_code = 503 if result['state']=='unavailable' else 200
        response.headers['Cache-Control'] = 'no-store'
        return response
    @app.get('/tiles/<source>')
    def tile(source):
        if source not in caches:
            abort(404)
        return render_template('tile.html', source=source, station=os.getenv('STATION_NAME', 'Herne Hill' if os.getenv('STATION_CODE','HNH')=='HNH' else os.getenv('STATION_CODE')))
    return app

app = create_app()
