import { normalize,matchesText } from './filter.mjs';
const instances = new Map();
let opened = null;
export function syncSelect(id) { instances.get(id)?.sync(); }
export function enhanceSelects(ids) {
  for (const id of ids) instances.set(id, new SearchSelect(document.getElementById(id)));
}
class SearchSelect {
  constructor(select) {
    this.select = select;
    this.label = { 'pt-filter':'Perguruan tinggi', 'prodi-filter':'Program studi', 'status-filter':'Status PT', 'page-size':'Baris per halaman' }[select.id];
    select.hidden = true;
    this.button = document.createElement('button');
    this.button.type = 'button'; this.button.className = 'select-trigger';
    this.button.setAttribute('role','combobox'); this.button.setAttribute('aria-label',this.label);
    this.button.setAttribute('aria-haspopup','listbox'); this.button.setAttribute('aria-expanded','false');
    this.button.setAttribute('aria-controls',select.id + '-choices');
    select.after(this.button);
    this.popover = document.createElement('div'); this.popover.className = 'select-popover'; this.popover.hidden = true;
    this.input = document.createElement('input'); this.input.type = 'search';
    this.input.placeholder = 'Cari ' + this.label.toLocaleLowerCase('id') + '…';
    this.input.setAttribute('aria-label',this.input.placeholder.slice(0,-1));
    this.list = document.createElement('div'); this.list.className = 'select-choices';
    this.list.id = select.id + '-choices'; this.list.setAttribute('role','listbox'); this.list.setAttribute('aria-label','Pilihan ' + this.label.toLocaleLowerCase('id'));
    this.note = document.createElement('div'); this.note.className = 'select-note'; this.note.setAttribute('aria-live','polite');
    this.popover.append(this.input,this.list,this.note); document.body.append(this.popover);
    this.button.addEventListener('click',()=>this.popover.hidden ? this.open() : this.close());
    this.button.addEventListener('keydown',event=>{ if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); this.open(); } });
    this.input.addEventListener('input',()=>this.render());
    this.popover.addEventListener('keydown',event=>{
      if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
      if (event.key === 'Tab') this.close();
      const choices = [...this.list.querySelectorAll('button')];
      if (!choices.length) return;
      const current = choices.indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault(); choices[Math.max(0,Math.min(choices.length-1,current + (event.key==='ArrowDown'?1:-1)))].focus();
      } else if (event.key === 'Enter' && document.activeElement === this.input) { event.preventDefault(); choices[0].click(); }
    });
    select.addEventListener('change',()=>this.sync());
    document.addEventListener('pointerdown',event=>{ if (opened === this && !this.button.contains(event.target) && !this.popover.contains(event.target)) this.close(); });
    window.addEventListener('resize',()=>{ if (opened === this) this.position(); });
    window.addEventListener('scroll',()=>{ if (opened === this) this.position(); },true);
    this.sync();
  }
  sync() {
    this.button.textContent = this.select.selectedOptions[0]?.textContent || 'Pilih…';
    this.button.title = this.button.textContent;
    if (!this.popover.hidden) this.render();
  }
  position() {
    const rect = this.button.getBoundingClientRect(), width = Math.min(Math.max(rect.width,300),window.innerWidth-24);
    const height = Math.min(360,window.innerHeight-24);
    const below = window.innerHeight-rect.bottom-12;
    const top = below >= Math.min(height,220) ? rect.bottom+6 : Math.max(12,rect.top-Math.min(height,this.popover.offsetHeight)-6);
    Object.assign(this.popover.style,{width:width+'px',left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px',top:top+'px',maxHeight:Math.max(120,window.innerHeight-top-12)+'px'});
  }
  open() {
    opened?.close(); opened = this;
    this.popover.hidden = false; this.button.setAttribute('aria-expanded','true'); this.input.value = '';
    this.render(); this.position(); this.input.focus();
  }
  close(focus = false) {
    this.popover.hidden = true; this.button.setAttribute('aria-expanded','false');
    if (opened === this) opened = null;
    if (focus) this.button.focus();
  }
  render() {
    const query = normalize(this.input.value).trim();
    const options = [...this.select.options].filter(option=>!query || matchesText(option.textContent,query));
    this.list.replaceChildren();
    for (const option of options.slice(0,100)) {
      const choice = document.createElement('button'); choice.type = 'button'; choice.setAttribute('role','option');
      choice.setAttribute('aria-selected',String(option.value === this.select.value)); choice.textContent = option.textContent;
      choice.addEventListener('click',()=>{ this.select.value = option.value; this.close(true); this.sync(); this.select.dispatchEvent(new Event('change',{bubbles:true})); });
      this.list.append(choice);
    }
    this.note.textContent = !options.length ? 'Tidak ada pilihan yang cocok.' : options.length>100 ? `100 dari ${options.length.toLocaleString('id-ID')} pilihan. Ketik untuk mempersempit pencarian.` : `${options.length.toLocaleString('id-ID')} pilihan`;
  }
}
