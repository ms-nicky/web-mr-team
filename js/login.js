(() => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const loginForm = document.getElementById('login-form');
  const feedback = document.getElementById('login-feedback');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = loginForm.querySelector('button[type="submit"]');

      feedback.textContent = '';
      feedback.className = 'login-feedback';
      feedback.textContent = 'Memverifikasi...';
      if (button) button.disabled = true;

      const formData = new FormData(loginForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const contentType = res.headers.get('Content-Type') || '';
        let result;

        if (contentType.includes('application/json')) {
          result = await res.json();
        } else {
          const text = await res.text();
          throw new Error(`Server returned: ${text}`);
        }

        if (!res.ok) {
          feedback.textContent = result.error || 'Username atau password salah.';
          feedback.classList.add('error');
        } else {
          feedback.textContent = 'Login berhasil! Mengalihkan...';
          feedback.classList.add('success');
          setTimeout(() => {
            window.location.href = result.redirect || '/dashboard';
          }, 1200);
        }
      } catch (err) {
        feedback.textContent = err.message || 'Terjadi kesalahan saat login.';
        feedback.classList.add('error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
})();
