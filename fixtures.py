"""Explicit opt-in development data; never a fallback for production failures."""
from datetime import timedelta, datetime
from app import now, LONDON, COLOURS

def fetchers():
    def buses():
        return [dict(line=['2','432','2','432','2','415','2','432'][i], destination=['Marylebone','Brixton','Marylebone','Brixton','Marylebone','Old Kent Road, Tesco','Marylebone','Brixton'][i], arrival=(now()+timedelta(minutes=m)).isoformat()) for i,m in enumerate([2,5,11,16,17,20,25,28])]
    def tube():
        return [dict(name=n,status='Severe Delays' if n=='Northern' else 'Minor Delays' if n=='Central' else 'Good Service',severity='major' if n=='Northern' else 'warn' if n=='Central' else 'good',color=c,reason=('Development fixture: disruption details. '*25) if n in ('Northern','Central') else '') for n,c in COLOURS.items()]
    def trains():
        return {p:[dict(std=(now()+timedelta(minutes=m)).astimezone(LONDON).strftime('%H:%M'),etd='On time',platform=p,destination='St Albans' if p=='1' else 'London Victoria',operatorCode='TL' if p=='1' else 'SE',arrival=(now()+timedelta(minutes=m)).isoformat()) for m in (4,16,31,46)] for p in ('1','2')}
    def carbon():
        import math
        start=datetime.combine(now().astimezone(LONDON).date(),datetime.min.time(),LONDON)
        return [{'from':(start+timedelta(minutes=i*30)).isoformat(),'to':(start+timedelta(minutes=(i+1)*30)).isoformat(),'intensity':{'forecast':round(150+100*math.sin(i/12)),'index':'moderate'}} for i in range(96)]
    return dict(buses=buses,tube=tube,trains=trains,carbon=carbon)
