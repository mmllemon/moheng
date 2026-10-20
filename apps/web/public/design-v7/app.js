(function () {
  'use strict';

  const root = document.documentElement;
  const lensButtons = Array.from(document.querySelectorAll('[data-lens]'));
  const toast = document.getElementById('toast');
  const drawer = document.getElementById('drawer');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const drawerTitle = document.getElementById('drawerTitle');
  const drawerMeta = document.getElementById('drawerMeta');
  const drawerText = document.getElementById('drawerText');
  const drawerForm = document.getElementById('drawerForm');
  const drawerNote = document.getElementById('drawerNote');
  const drawerClose = document.getElementById('drawerClose');
  const noteList = document.getElementById('noteList');
  const noteCount = document.getElementById('noteCount');
  const noteForm = document.getElementById('noteForm');
  const newNote = document.getElementById('newNote');
  const planCanvas = document.getElementById('planCanvas');
  const planZoom = document.getElementById('planZoom');
  const stampButton = document.getElementById('stampButton');
  const sealStamp = document.getElementById('sealStamp');
  const stampCaption = document.getElementById('stampCaption');
  const stampLog = document.getElementById('stampLog');
  const scaleControl = document.getElementById('scaleControl');
  const scaleMarker = document.getElementById('scaleMarker');
  const scaleAmount = document.getElementById('scaleAmount');
  const scalePercent = document.getElementById('scalePercent');
  const rateLabel = document.getElementById('rateLabel');

  const TARGET_COST = 1116800;
  const notes = [
    { id: 'n1', title: '主合同确认函', text: '主合同金额与业主确认函一致，待归档盖章。', author: '王工', date: '10/20 16:10', x: 31, y: 42 },
    { id: 'n2', title: '钢材进场单', text: '材料费占比偏高，核对 10 月钢筋进场单与发票。', author: '李工', date: '10/20 15:42', x: 62, y: 35 },
    { id: 'n3', title: '分供合同待关联', text: '分供合同尚未关联，结算前补齐合同链与付款计划。', author: '王工', date: '10/20 14:26', x: 73, y: 67 },
  ];
  let currentNote = null;
  let previousFocus = null;
  let noteIndex = notes.length;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function setLens(lens) {
    if (!['survey', 'mural', 'notes'].includes(lens)) return;
    root.dataset.lens = lens;
    lensButtons.forEach((button) => {
      const active = button.dataset.lens === lens;
      button.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('mh-design-v7-lens', lens); } catch (error) { /* private mode */ }
  }

  lensButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setLens(button.dataset.lens);
      showToast(button.dataset.lens === 'survey' ? '测绘稿：网格、标尺与坐标展开' : button.dataset.lens === 'mural' ? '山河稿：矿物色层与等高线展开' : '批注稿：页边批注与手写层展开');
    });
  });
  try {
    const savedLens = localStorage.getItem('mh-design-v7-lens');
    if (savedLens) setLens(savedLens);
  } catch (error) { /* private mode */ }

  const formatMoney = (value) => '¥' + Math.round(value).toLocaleString('zh-CN');
  const clamp = (value) => Math.max(0, Math.min(100, value));

  function setRate(percent) {
    const value = clamp(Number(percent) || 0);
    const amount = TARGET_COST * value / 100;
    scaleMarker.style.left = value + '%';
    scaleMarker.querySelector('span').textContent = value.toFixed(1) + '%';
    scalePercent.textContent = value.toFixed(1) + '%';
    scaleAmount.textContent = formatMoney(amount);
    rateLabel.textContent = '执行 ' + value.toFixed(1) + '%';
    scaleControl.setAttribute('aria-valuenow', value.toFixed(1));
    scaleControl.setAttribute('aria-valuetext', '成本执行率 ' + value.toFixed(1) + '%，对应 ' + formatMoney(amount));
  }

  function rateFromPointer(event) {
    const rect = scaleControl.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * 100;
  }

  scaleControl.addEventListener('pointerdown', (event) => {
    scaleControl.setPointerCapture(event.pointerId);
    setRate(rateFromPointer(event));
    const move = (moveEvent) => setRate(rateFromPointer(moveEvent));
    const up = () => {
      scaleControl.removeEventListener('pointermove', move);
      scaleControl.removeEventListener('pointerup', up);
      scaleControl.removeEventListener('pointercancel', up);
    };
    scaleControl.addEventListener('pointermove', move);
    scaleControl.addEventListener('pointerup', up);
    scaleControl.addEventListener('pointercancel', up);
  });

  scaleControl.addEventListener('keydown', (event) => {
    const current = Number(scaleControl.getAttribute('aria-valuenow')) || 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setRate(current - 1); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setRate(current + 1); }
    else if (event.key === 'Home') { event.preventDefault(); setRate(0); }
    else if (event.key === 'End') { event.preventDefault(); setRate(100); }
  });

  function stampDate() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + '.' + pad(date.getMonth() + 1) + '.' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function applyStamp() {
    sealStamp.classList.remove('is-stamped');
    // Reflow so the seal animation can be replayed.
    void sealStamp.offsetWidth;
    sealStamp.classList.add('is-stamped');
    const stampTime = stampDate();
    stampCaption.textContent = '项目章 · ' + stampTime;
    stampLog.textContent = '已落印 · ' + stampTime + ' · 王工';
    stampButton.textContent = '已落印';
    stampButton.classList.add('is-stamped');
    stampButton.setAttribute('aria-label', '已落印，点击重新落印');
    showToast('项目章已落在图签栏');
  }
  stampButton.addEventListener('click', applyStamp);

  function renderNotes() {
    noteList.replaceChildren();
    notes.forEach((note) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-card';
      button.dataset.noteId = note.id;
      button.setAttribute('aria-label', '打开批注：' + note.title);
      const head = document.createElement('span');
      head.className = 'note-head';
      const title = document.createElement('strong');
      title.textContent = note.title;
      const author = document.createElement('span');
      author.textContent = note.author;
      head.append(title, author);
      const text = document.createElement('p');
      text.className = 'note-text';
      text.textContent = note.text;
      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = note.date + ' · 现场批注';
      button.append(head, text, meta);
      button.addEventListener('click', () => openDrawer(note));
      noteList.append(button);
    });
    noteCount.textContent = notes.length + ' 则';
    document.querySelectorAll('.pin').forEach((pin) => {
      if (pin.dataset.bound === 'true') return;
      pin.dataset.bound = 'true';
      pin.addEventListener('click', () => {
        const note = notes.find((item) => item.id === pin.dataset.noteId);
        if (note) openDrawer(note);
      });
    });
  }

  function addPin(note) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin pin-new';
    pin.dataset.noteId = note.id;
    pin.style.left = note.x + '%';
    pin.style.top = note.y + '%';
    pin.setAttribute('aria-label', '批注：' + note.title);
    pin.dataset.bound = 'true';
    pin.innerHTML = '<span>' + (notes.length) + '</span>';
    pin.addEventListener('click', () => openDrawer(note));
    planCanvas.append(pin);
  }

  function openDrawer(note) {
    currentNote = note;
    previousFocus = document.activeElement;
    drawerTitle.textContent = note.title;
    drawerMeta.textContent = note.author + ' · ' + note.date + ' · 现场批注';
    drawerText.textContent = note.text;
    drawerNote.value = '';
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => drawerNote.focus());
  }

  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
    currentNote = null;
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    previousFocus = null;
  }

  drawerClose.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);

  function keepDrawerFocus(event) {
    if (event.key !== 'Tab' || drawer.hidden) return;
    const focusable = Array.from(drawer.querySelectorAll('button,textarea,input,a[href]')).filter((element) => !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  document.addEventListener('keydown', (event) => {
    if (!drawer.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
      keepDrawerFocus(event);
      return;
    }
    const tag = document.activeElement && document.activeElement.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (event.key === '1') setLens('survey');
    if (event.key === '2') setLens('mural');
    if (event.key === '3') setLens('notes');
  });

  function appendNote(title, text) {
    noteIndex += 1;
    const note = {
      id: 'n' + noteIndex,
      title,
      text,
      author: '现场测绘',
      date: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
      x: 24 + ((noteIndex * 17) % 52),
      y: 32 + ((noteIndex * 13) % 38),
    };
    notes.push(note);
    renderNotes();
    addPin(note);
    return note;
  }

  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = newNote.value.trim();
    if (!text) return;
    appendNote('现场补注', text);
    newNote.value = '';
    showToast('批注已写入页边');
  });

  drawerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = drawerNote.value.trim();
    if (!text) return;
    const parentTitle = currentNote ? currentNote.title : '现场补注';
    appendNote('补注 · ' + parentTitle, text);
    closeDrawer();
    showToast('补注已追加到批注栏');
  });

  planZoom.addEventListener('click', () => {
    const focused = planCanvas.classList.toggle('is-focused');
    planZoom.innerHTML = focused ? '全图 <span>－</span>' : '局部 <span>＋</span>';
    planZoom.setAttribute('aria-label', focused ? '返回项目总图' : '聚焦 A-01 主楼');
    showToast(focused ? '已聚焦 A-01 主楼' : '已返回项目总图');
  });

  // Keep the folio index in sync with the sheet as the reader scrolls.
  const folioLinks = Array.from(document.querySelectorAll('.folio-nav a'));
  const sections = folioLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      folioLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === '#' + entry.target.id));
    });
  }, { rootMargin: '-25% 0px -60% 0px', threshold: 0 });
  sections.forEach((section) => observer.observe(section));

  renderNotes();
  setRate((74800 / TARGET_COST) * 100);
})();
