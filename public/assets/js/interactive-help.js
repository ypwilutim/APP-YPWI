(function () {
  'use strict';

  function rectOf(selector) {
    try {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const pad = 6;
      return {
        el,
        left: r.left - pad,
        top: r.top - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2
      };
    } catch (e) {
      return null;
    }
  }

  function createTombolBantuan() {
    const btn = document.createElement('button');
    btn.className = 'ih-tombol-bantuan';
    btn.id = 'ihTombolBantuan';
    btn.setAttribute('aria-label', 'Bantuan panduan');
    btn.innerHTML = '<i class="fas fa-question"></i>';
    document.body.appendChild(btn);
    return btn;
  }

  function GuideManager() {
    this.name = '';
    this.steps = [];
    this.current = 0;
    this.overlay = null;
    this.spot = null;
    this.modal = null;
    this.tip = null;
    this.removed = false;
    this.btn = null;
  }

  GuideManager.prototype.initStorage = function () {
    const key = 'ih_done_' + this.name;
    return {
      key: key,
      isDone: function () {
        try {
          return localStorage.getItem(key) === '1';
        } catch (e) {
          return false;
        }
      },
      setDone: function () {
        try {
          localStorage.setItem(key, '1');
        } catch (e) {
        }
      },
      reset: function () {
        try {
          localStorage.removeItem(key);
        } catch (e) {
        }
      }
    };
  };

  GuideManager.prototype.createButton = function (opts) {
    const existing = document.getElementById('ihTombolBantuan');
    if (existing) {
      this.btn = existing;
      return existing;
    }
    this.btn = createTombolBantuan();
    const storage = this.initStorage();
    this.btn.addEventListener('click', () => {
      if (storage.isDone()) {
        this.restart();
      } else {
        this.start();
      }
    });
    if (opts && opts.tooltip) {
      const tip = document.createElement('span');
      tip.className = 'ih-tooltip';
      tip.textContent = opts.tooltip;
      this.tip = tip;
      this.btn.appendChild(tip);
      this.btn.addEventListener('mouseenter', () => {
        tip.style.opacity = '1';
        const bcr = this.btn.getBoundingClientRect();
        tip.style.bottom = '100%';
        tip.style.left = '50%';
        tip.style.transform = 'translateX(-50%)';
      });
      this.btn.addEventListener('mouseleave', () => {
        tip.style.opacity = '0';
      });
    }
  };

  GuideManager.prototype.buildModal = function () {
    const overlay = document.createElement('div');
    overlay.className = 'ih-overlay';
    const spot = document.createElement('div');
    spot.className = 'ih-spot';
    overlay.appendChild(spot);

    const modal = document.createElement('div');
    modal.className = 'ih-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML =
      '<div class="ih-modal-header">' +
      '<span class="ih-title"></span>' +
      '<button class="ih-close" aria-label="Tutup"><i class="fas fa-times"></i></button>' +
      '</div>' +
      '<div class="ih-modal-body"><div class="ih-content"></div></div>' +
      '<div class="ih-modal-footer">' +
      '<div class="ih-dots"></div>' +
      '<div class="ih-actions">' +
      '<button class="ih-btn ih-skip">Lewati</button>' +
      '<button class="ih-btn ih-prev">Sebelumnya</button>' +
      '<button class="ih-btn ih-next primary">Selanjutnya</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    this.overlay = overlay;
    this.spot = spot;
    this.modal = modal;

    modal.querySelector('.ih-close').addEventListener('click', () => this.finish());
    modal.querySelector('.ih-skip').addEventListener('click', () => this.finish());
    modal.querySelector('.ih-prev').addEventListener('click', () => this.prev());
    modal.querySelector('.ih-next').addEventListener('click', () => this.next());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.finish();
    });

    document.addEventListener('keydown', this._keyHandler = (e) => {
      if (!this.modal || !document.contains(this.modal)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finish();
      }
    });
  };

  GuideManager.prototype.renderDots = function () {
    const dots = this.modal.querySelector('.ih-dots');
    dots.innerHTML = '';
    this.steps.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'ih-dot' + (i === this.current ? ' ih-active' : '');
      dot.addEventListener('click', () => this.goTo(i));
      dots.appendChild(dot);
    });
  };

  GuideManager.prototype.highlight = function (target) {
    this.spot.style.cssText = '';
    if (!target) {
      this.spot.style.display = 'none';
      return;
    }
    const r = rectOf(target);
    if (!r) {
      this.spot.style.display = 'none';
      return;
    }
    const size = Math.max(r.width, r.height) + 16;
    const offsetX = r.left + r.width / 2 - size / 2;
    const offsetY = r.top + r.height / 2 - size / 2;
    this.spot.style.display = 'block';
    this.spot.style.left = offsetX + 'px';
    this.spot.style.top = offsetY + 'px';
    this.spot.style.width = size + 'px';
    this.spot.style.height = size + 'px';
    this.spot.style.boxShadow =
      '0 0 0 9999px rgba(0,0,0,0.78), inset 0 0 0 9999px rgba(0,0,0,0.0)';
  };

  GuideManager.prototype.scrollToTarget = function (target) {
    const r = rectOf(target);
    if (!r) return;
    const el = r.el;
    const rect = el.getBoundingClientRect();
    const inView =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);
    if (!inView) {
      const align = rect.top < 120 ? 'start' : 'center';
      el.scrollIntoView({ behavior: 'smooth', block: align });
    }
  };

  GuideManager.prototype.updatePositions = function () {
    if (!this.modal) return;
    const modalRect = this.modal.getBoundingClientRect();
    let pos = 'right';
    if (modalRect.right > window.innerWidth - 200) {
      pos = 'left';
    }
    this.modal.style.right = pos === 'right' ? '24px' : 'auto';
    this.modal.style.left = pos === 'right' ? 'auto' : '24px';
    this.modal.style.bottom = '24px';
  };

  GuideManager.prototype.showStep = function () {
    if (!this.modal) return;
    const step = this.steps[this.current];
    if (!step) return;

    this.modal.querySelector('.ih-title').textContent = step.title || '';
    const content = this.modal.querySelector('.ih-content');
    content.innerHTML = '';
    if (step.content) {
      const p = document.createElement('p');
      p.textContent = step.content;
      content.appendChild(p);
    }
    if (step.note) {
      const note = document.createElement('p');
      note.textContent = step.note;
      note.style.fontSize = '12px';
      note.style.color = '#6b7280';
      content.appendChild(note);
    }

    this.highlight(step.target);

    const prevBtn = this.modal.querySelector('.ih-prev');
    const nextBtn = this.modal.querySelector('.ih-next');
    prevBtn.style.display = this.current === 0 ? 'none' : 'inline-flex';
    const isLast = this.current >= this.steps.length - 1;
    nextBtn.textContent = isLast ? 'Selesai' : 'Selanjutnya';
    nextBtn.classList.toggle('primary', true);

    if (step.target) {
      this.scrollToTarget(step.target);
    }

    this.renderDots();
    this.modal.classList.add('ih-show');
    this.updatePositions();
  };

  GuideManager.prototype.start = function () {
    if (this.removed) return;
    if (!this.modal) {
      this.buildModal();
    }
    this.modal.classList.add('ih-show');
    this.btn.classList.add('ih-active');
    this.showStep();
  };

  GuideManager.prototype.restart = function () {
    this.current = 0;
    this.start();
  };

  GuideManager.prototype.goTo = function (index) {
    if (index < 0) index = 0;
    if (index >= this.steps.length) index = this.steps.length - 1;
    this.current = index;
    this.showStep();
  };

  GuideManager.prototype.next = function () {
    if (this.current >= this.steps.length - 1) {
      this.finish();
    } else {
      this.current++;
      this.showStep();
    }
  };

  GuideManager.prototype.prev = function () {
    if (this.current > 0) {
      this.current--;
      this.showStep();
    }
  };

  GuideManager.prototype.finish = function () {
    if (this.modal) {
      this.modal.classList.remove('ih-show');
      if (this.keyHandler) {
        document.removeEventListener('keydown', this._keyHandler);
      }
      setTimeout(() => {
        if (this.overlay && this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
        if (this.modal && this.modal.parentNode) {
          this.modal.parentNode.removeChild(this.modal);
        }
        this.modal = null;
        this.overlay = null;
        this.spot = null;
      }, 200);
    }
    this.highlight(null);
    if (this.btn) {
      this.btn.classList.remove('ih-active');
    }
    const storage = this.initStorage();
    storage.setDone();
  };

  GuideManager.prototype.remove = function () {
    this.removed = true;
    this.finish();
    if (this.btn && this.btn.parentNode) {
      this.btn.parentNode.removeChild(this.btn);
    }
  };

  window.initGuide = function (opts) {
    opts = opts || {};
    if (!opts.name || !opts.steps || !opts.steps.length) return null;
    const guide = new GuideManager();
    guide.name = opts.name;
    guide.steps = opts.steps.map(function (s) {
      return {
        title: s.title || '',
        content: s.content || '',
        note: s.note || '',
        target: s.target || null,
        position: s.position || null
      };
    });
    guide.createButton({ tooltip: opts.tooltip });
    window['guide_' + opts.name] = guide;
    return guide;
  };

  // ---- Modal Penjelasan Detail (single content modal) ----
  // Merupakan "panduan panjang": tombol bantuan melayang -> modal isi HTML lengkap.
  window.openHelpModal = (function () {
    var singleton = null;
    return function (opts) {
      opts = opts || {};
      var name = opts.name || 'helpModal';
      if (!singleton) {
        var btn = createTombolBantuan();
        btn.id = 'ihHelpBtn';
        singleton = { btn: btn, overlay: null, modal: null };
        btn.addEventListener('click', function () {
          singleton._open();
        });
        singleton._build = function () {
          if (singleton.modal) return;
          var overlay = document.createElement('div');
          overlay.className = 'ih-overlay';
          var modal = document.createElement('div');
          modal.className = 'ih-modal';
          modal.setAttribute('role', 'dialog');
          modal.setAttribute('aria-modal', 'true');
          overlay.appendChild(modal);
          modal.innerHTML =
            '<div class="ih-modal-header">' +
            '<span class="ih-title"></span>' +
            '<button class="ih-close" aria-label="Tutup"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="ih-modal-body ih-rich"></div>' +
            '<div class="ih-modal-footer">' +
            '<button class="ih-btn ih-finish primary">Tutup</button>' +
            '</div>';
          modal.querySelector('.ih-close').addEventListener('click', closeFn);
          modal.querySelector('.ih-finish').addEventListener('click', closeFn);
          overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeFn();
          });
          document.addEventListener('keydown', keyFn);
          singleton.overlay = overlay;
          singleton.modal = modal;
        };
        function closeFn() {
          if (!singleton.modal) return;
          singleton.modal.classList.remove('ih-show');
          setTimeout(function () {
            if (singleton.overlay && singleton.overlay.parentNode) {
              singleton.overlay.parentNode.removeChild(singleton.overlay);
            }
            singleton.modal = null;
            singleton.overlay = null;
          }, 200);
          if (singleton.btn) singleton.btn.classList.remove('ih-active');
        }
        function keyFn(e) {
          if (!singleton.modal || !document.contains(singleton.modal)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            closeFn();
          }
        }
        singleton._open = function () {
          this._build();
          var modal = singleton.modal;
          if (!document.body.contains(singleton.overlay)) document.body.appendChild(singleton.overlay);
          modal.querySelector('.ih-title').textContent = singleton._title || 'Panduan';
          modal.querySelector('.ih-modal-body').innerHTML = singleton._html || '';
          modal.classList.add('ih-show');
          if (singleton.btn) singleton.btn.classList.add('ih-active');
        };
        singleton._title = opts.title || 'Panduan';
        singleton._html = opts.html || '';
        singleton.tooltip = opts.tooltip || 'Bantuan / Panduan lengkap';
        singleton.btn.title = singleton.tooltip;
      } else {
        singleton._title = opts.title || (singleton._title || 'Panduan');
        singleton._html = opts.html || (singleton._html || '');
        if (opts.tooltip) {
          singleton.tooltip = opts.tooltip;
          singleton.btn.title = opts.tooltip;
        }
        singleton._open();
      }
      singleton._build();
      return singleton;
    };
  })();
})();
