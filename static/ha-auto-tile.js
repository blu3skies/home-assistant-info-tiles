class HomeInfoAutoTile extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.onMessage = event => {
      const data = event.data;
      if (!this.frame || event.source !== this.frame.contentWindow ||
          event.origin !== this.origin || data?.type !== 'home-info-tile-height' ||
          data.channel !== this.channel || !Number.isFinite(data.height)) return;
      const height = Math.max(40, Math.min(6000, Math.ceil(data.height)));
      if (height === this.height) return;
      this.height = height;
      this.frame.style.height = `${height}px`;
      this.dispatchEvent(new Event('iron-resize', {bubbles: true, composed: true}));
    };
  }
  setConfig(config) {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('A local HTTP or HTTPS tile URL is required');
    this.config = config;
    this.origin = url.origin;
    this.channel = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
    url.searchParams.set('ha_auto', '1');
    url.searchParams.set('ha_parent', location.origin);
    url.searchParams.set('ha_channel', this.channel);
    this.shadowRoot.innerHTML = '<style>:host{display:block;min-width:0}ha-card{display:block;overflow:hidden}iframe{display:block;width:100%;border:0;height:200px}</style><ha-card><iframe loading="eager"></iframe></ha-card>';
    this.frame = this.shadowRoot.querySelector('iframe');
    this.frame.title = config.title || 'Home information tile';
    this.frame.src = url.href;
    this.height = 200;
  }
  connectedCallback() { window.addEventListener('message', this.onMessage); }
  disconnectedCallback() { window.removeEventListener('message', this.onMessage); }
  getCardSize() { return Math.ceil((this.height || 200) / 50); }
  getGridOptions() { return {columns: this.config?.columns || 12, rows: 'auto', min_columns: 6}; }
}
if (!customElements.get('home-info-auto-tile')) customElements.define('home-info-auto-tile', HomeInfoAutoTile);
window.customCards = window.customCards || [];
window.customCards.push({type: 'home-info-auto-tile', name: 'Auto-sizing home information tile', description: 'Fits the tile to its current list length.'});
