(() => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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
})();
