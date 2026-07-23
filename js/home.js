(() => {
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  async function loadTeam() {
    const grid = document.getElementById('member-grid');
    if (!grid) return;

    try {
      const res = await fetch('/api/team');
      const data = await res.json();
      const team = data.team || [];
      if (team.length === 0) {
        grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1">Belum ada team operators.</p>';
        return;
      }
      grid.innerHTML = team.map(t => `
        <article class="member-card">
          <div class="member-img-wrap">
            ${t.image ? `<img src="${esc(t.image)}" alt="${esc(t.name)}" width="600" height="600" loading="lazy" decoding="async">` : ''}
          </div>
          <div class="member-body">
            <h3>${esc(t.name)}</h3>
            <p class="member-role">${esc(t.role)}</p>
            <span class="member-tag">${esc(t.tag)}</span>
          </div>
        </article>
      `).join('');
    } catch (err) {
      grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1">Gagal memuat data team.</p>';
    }
  }

  function initSupportForm() {
    const supportForm = document.getElementById('support-form');
    const feedback = document.getElementById('support-feedback');
    if (!supportForm) return;

    supportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = supportForm.querySelector('button[type="submit"]');
      feedback.textContent = '';
      feedback.className = 'support-feedback';
      feedback.textContent = 'Mengirim...';
      if (btn) btn.disabled = true;

      const formData = new FormData(supportForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const res = await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (!res.ok) {
          feedback.textContent = result.error || 'Gagal mengirim pesan.';
          feedback.classList.add('error');
        } else {
          feedback.textContent = 'Pesan berhasil dikirim! Tim support akan segera merespon.';
          feedback.classList.add('success');
          supportForm.reset();
        }
      } catch (err) {
        feedback.textContent = 'Terjadi kesalahan. Silakan coba lagi.';
        feedback.classList.add('error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  loadTeam();
  initSupportForm();
})();
