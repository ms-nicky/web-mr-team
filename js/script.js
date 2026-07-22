(() => {
  /* ── Year ── */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ── Callsign rotator ── */
  const callEl   = document.getElementById('callsign');
  const modes    = ['DEFENSE', 'OFFENSE', 'RESEARCH', 'AUTOMATION'];
  const calm     = typeof window !== 'undefined' &&
                   window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 640px)').matches;
  let   modeIdx  = 0;

  if (callEl && !calm) {
    setInterval(() => {
      callEl.style.opacity = '0';
      setTimeout(() => {
        modeIdx = (modeIdx + 1) % modes.length;
        callEl.textContent  = modes[modeIdx];
        callEl.style.opacity = '1';
      }, 160);
    }, 2000);
  }

  /* ── Scroll reveal ── */
  const canReveal = !calm && 'IntersectionObserver' in window;

  if (canReveal) {
    document.body.classList.add('reveal-ready');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18 });

    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  }

  /* ── Active nav link on scroll ── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('nav a[href^="#"]');

  if (navLinks.length && 'IntersectionObserver' in window) {
    const navIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          navLinks.forEach(a => a.style.color = '');
          const link = document.querySelector(`nav a[href="#${e.target.id}"]`);
          if (link) link.style.color = 'var(--red-soft)';
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });

    sections.forEach(s => navIO.observe(s));
  }

  /* ── Support form submit ── */
  const supportForm = document.getElementById('support-form');
  const supportFeedback = document.getElementById('support-feedback');
  const supportTokenInput = document.getElementById('support-token');

  async function refreshSupportToken() {
    try {
      const response = await fetch('/api/support-token');
      if (!response.ok) {
        throw new Error('Gagal mengambil token support');
      }
      const { token } = await response.json();
      if (supportTokenInput) {
        supportTokenInput.value = token;
      }
    } catch (error) {
      console.error('Support token error:', error);
      if (supportFeedback) {
        supportFeedback.textContent = 'Tidak dapat memuat token support. Segarkan halaman dan coba lagi.';
      }
    }
  }

  if (supportForm) {
    refreshSupportToken();

    supportForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = supportForm.querySelector('button[type="submit"]');

      supportFeedback.textContent = 'Mengirim...';
      if (button) button.disabled = true;

      await refreshSupportToken();
      const formData = new FormData(supportForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const response = await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const contentType = response.headers.get('Content-Type') || '';
        let result;

        if (contentType.includes('application/json')) {
          result = await response.json();
        } else {
          const text = await response.text();
          throw new Error(`Server returned invalid JSON: ${text}`);
        }

        if (!response.ok) {
          if (result.error && result.error.toLowerCase().includes('support token')) {
            await refreshSupportToken();
            supportFeedback.textContent = 'Token support kedaluwarsa. Silakan coba lagi.';
          } else {
            supportFeedback.textContent = result.error || 'Gagal mengirim pesan support.';
          }
        } else {
          supportFeedback.textContent = 'Pesan support berhasil dikirim. Tim kami akan segera menindaklanjuti.';
          supportForm.reset();
        }
      } catch (error) {
        supportFeedback.textContent = error.message || 'Terjadi kesalahan saat mengirim pesan support.';
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
})();
