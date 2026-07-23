(() => {
  /* ── Clock ── */
  const timeEl = document.getElementById('dash-time');
  function updateClock() {
    const now = new Date();
    if (timeEl) timeEl.textContent = now.toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ── Sidebar toggle (mobile) ── */
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  /* ── Tab switching ── */
  const sidebarLinks = document.querySelectorAll('.sidebar-link[data-tab]');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const dashTitle = document.getElementById('dash-title');

  sidebarLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;

      sidebarLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      tabPanels.forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('tab-' + tab);
      if (panel) panel.classList.add('active');

      if (dashTitle) dashTitle.textContent = link.querySelector('span').textContent;
      sidebar.classList.remove('open');
    });
  });

  /* ── API helpers ── */
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    throw new Error('Invalid response');
  }

  /* ── Members ── */
  const membersBody = document.getElementById('members-table-body');
  const overviewMembers = document.getElementById('overview-members');
  const statMembers = document.getElementById('stat-members');
  const statActive = document.getElementById('stat-active');

  async function loadMembers() {
    try {
      const data = await api('/api/members');
      const members = data.members || [];

      if (statMembers) statMembers.textContent = members.length;
      if (statActive) statActive.textContent = members.length;

      if (membersBody) {
        if (members.length === 0) {
          membersBody.innerHTML = '<tr><td colspan="5" class="empty-text">Belum ada member.</td></tr>';
        } else {
          membersBody.innerHTML = members.map(m => `
            <tr>
              <td>${m.id}</td>
              <td><strong>${esc(m.username)}</strong></td>
              <td><span class="role-badge role-${m.role}">${m.role}</span></td>
              <td>${formatDate(m.created_at)}</td>
              <td>
                <div class="action-btns">
                  <button class="action-btn edit" data-id="${m.id}" data-username="${esc(m.username)}" data-role="${m.role}" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="action-btn delete" data-id="${m.id}" data-username="${esc(m.username)}" title="Hapus">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          `).join('');

          membersBody.querySelectorAll('.action-btn.edit').forEach(btn => {
            btn.addEventListener('click', () => openEditModal(btn.dataset.id, btn.dataset.username, btn.dataset.role));
          });
          membersBody.querySelectorAll('.action-btn.delete').forEach(btn => {
            btn.addEventListener('click', () => openDeleteModal(btn.dataset.id, btn.dataset.username));
          });
        }
      }

      if (overviewMembers) {
        if (members.length === 0) {
          overviewMembers.innerHTML = '<p class="empty-text">Belum ada member.</p>';
        } else {
          overviewMembers.innerHTML = members.slice(0, 5).map(m => `
            <div class="recent-item">
              <div class="ri-dot"></div>
              <div class="ri-info">
                <span class="ri-user">${esc(m.username)}</span>
                <span class="ri-action">${m.role}</span>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Gagal memuat members:', err);
    }
  }

  /* ── Logs ── */
  const logsBody = document.getElementById('logs-table-body');
  const recentLogs = document.getElementById('recent-logs');
  const statLogs = document.getElementById('stat-logs');

  async function loadLogs() {
    try {
      const data = await api('/api/logs');
      const logs = data.logs || [];

      if (statLogs) statLogs.textContent = logs.length;

      if (logsBody) {
        if (logs.length === 0) {
          logsBody.innerHTML = '<tr><td colspan="4" class="empty-text">Belum ada aktivitas.</td></tr>';
        } else {
          logsBody.innerHTML = logs.map(l => `
            <tr>
              <td>${formatDate(l.created_at)}</td>
              <td><strong>${esc(l.username)}</strong></td>
              <td>${esc(l.action)}</td>
              <td>${esc(l.detail || '-')}</td>
            </tr>
          `).join('');
        }
      }

      if (recentLogs) {
        if (logs.length === 0) {
          recentLogs.innerHTML = '<p class="empty-text">Belum ada aktivitas.</p>';
        } else {
          recentLogs.innerHTML = logs.slice(0, 5).map(l => `
            <div class="recent-item">
              <div class="ri-dot"></div>
              <div class="ri-info">
                <span class="ri-user">${esc(l.username)}</span>
                <span class="ri-action">${esc(l.action)}</span>
              </div>
              <span class="ri-time">${formatDate(l.created_at)}</span>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Gagal memuat logs:', err);
    }
  }

  /* ── Add Member Modal ── */
  const modalOverlay = document.getElementById('modal-overlay');
  const memberForm = document.getElementById('member-form');
  const memberIdInput = document.getElementById('member-id');
  const memberUsername = document.getElementById('member-username');
  const memberPassword = document.getElementById('member-password');
  const memberRole = document.getElementById('member-role');
  const modalTitle = document.getElementById('modal-title');
  const modalPassword = document.getElementById('member-password');

  document.getElementById('btn-add-member').addEventListener('click', () => {
    modalTitle.textContent = 'Tambah Member';
    memberForm.reset();
    memberIdInput.value = '';
    modalPassword.required = true;
    modalOverlay.classList.add('open');
  });

  document.getElementById('modal-close').addEventListener('click', () => modalOverlay.classList.remove('open'));
  document.getElementById('modal-cancel').addEventListener('click', () => modalOverlay.classList.remove('open'));

  function openEditModal(id, username, role) {
    modalTitle.textContent = 'Edit Member';
    memberIdInput.value = id;
    memberUsername.value = username;
    memberPassword.value = '';
    memberPassword.required = false;
    memberRole.value = role;
    modalOverlay.classList.add('open');
  }

  memberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = memberIdInput.value;
    const payload = {
      username: memberUsername.value,
      role: memberRole.value
    };
    if (memberPassword.value) payload.password = memberPassword.value;

    try {
      if (id) {
        await api('/api/members/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        if (!memberPassword.value) return alert('Password harus diisi untuk member baru.');
        payload.password = memberPassword.value;
        await api('/api/members', { method: 'POST', body: JSON.stringify(payload) });
      }
      modalOverlay.classList.remove('open');
      loadMembers();
      loadLogs();
    } catch (err) {
      alert('Gagal menyimpan: ' + err.message);
    }
  });

  /* ── Delete Modal ── */
  const deleteOverlay = document.getElementById('delete-overlay');
  const deleteName = document.getElementById('delete-name');
  let deleteId = null;

  function openDeleteModal(id, username) {
    deleteId = id;
    deleteName.textContent = username;
    deleteOverlay.classList.add('open');
  }

  document.getElementById('delete-close').addEventListener('click', () => deleteOverlay.classList.remove('open'));
  document.getElementById('delete-cancel').addEventListener('click', () => deleteOverlay.classList.remove('open'));

  document.getElementById('delete-confirm').addEventListener('click', async () => {
    if (!deleteId) return;
    try {
      await api('/api/members/' + deleteId, { method: 'DELETE' });
      deleteOverlay.classList.remove('open');
      loadMembers();
      loadLogs();
    } catch (err) {
      alert('Gagal menghapus: ' + err.message);
    }
  });

  /* ── Refresh logs ── */
  const refreshBtn = document.getElementById('btn-refresh-logs');
  if (refreshBtn) refreshBtn.addEventListener('click', loadLogs);

  /* ── Team Operators ── */
  const teamGrid = document.getElementById('team-grid');
  const statTeam = document.getElementById('stat-logs');

  async function loadTeam() {
    try {
      const data = await api('/api/team');
      const team = data.team || [];

      if (teamGrid) {
        if (team.length === 0) {
          teamGrid.innerHTML = '<p class="empty-text">Belum ada team operators.</p>';
        } else {
          teamGrid.innerHTML = team.map(t => `
            <div class="team-card">
              <div class="team-card-img">
                ${t.image ? `<img src="${esc(t.image)}" alt="${esc(t.name)}" loading="lazy">` : ''}
              </div>
              <div class="team-card-body">
                <h4>${esc(t.name)}</h4>
                <p class="tc-role">${esc(t.role)}</p>
                <span class="role-badge role-member">${esc(t.tag)}</span>
                <div class="team-card-actions" style="margin-top:10px">
                  <button class="action-btn edit team-edit" data-id="${t.id}" data-name="${esc(t.name)}" data-role="${esc(t.role)}" data-tag="${esc(t.tag)}" data-image="${esc(t.image || '')}" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="action-btn delete team-delete" data-id="${t.id}" data-name="${esc(t.name)}" title="Hapus">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          `).join('');

          teamGrid.querySelectorAll('.team-edit').forEach(btn => {
            btn.addEventListener('click', () => openTeamEditModal(btn.dataset));
          });
          teamGrid.querySelectorAll('.team-delete').forEach(btn => {
            btn.addEventListener('click', () => openTeamDeleteModal(btn.dataset.id, btn.dataset.name));
          });
        }
      }
    } catch (err) {
      console.error('Gagal memuat team:', err);
    }
  }

  /* ── Team Modal ── */
  const teamModalOverlay = document.getElementById('team-modal-overlay');
  const teamForm = document.getElementById('team-form');
  const teamIdInput = document.getElementById('team-id');
  const teamNameInput = document.getElementById('team-name');
  const teamRoleInput = document.getElementById('team-role');
  const teamTagInput = document.getElementById('team-tag');
  const teamImageInput = document.getElementById('team-image');
  const teamModalTitle = document.getElementById('team-modal-title');

  document.getElementById('btn-add-team').addEventListener('click', () => {
    teamModalTitle.textContent = 'Tambah Operator';
    teamForm.reset();
    teamIdInput.value = '';
    teamModalOverlay.classList.add('open');
  });

  document.getElementById('team-modal-close').addEventListener('click', () => teamModalOverlay.classList.remove('open'));
  document.getElementById('team-modal-cancel').addEventListener('click', () => teamModalOverlay.classList.remove('open'));

  function openTeamEditModal(ds) {
    teamModalTitle.textContent = 'Edit Operator';
    teamIdInput.value = ds.id;
    teamNameInput.value = ds.name;
    teamRoleInput.value = ds.role;
    teamTagInput.value = ds.tag;
    teamImageInput.value = ds.image;
    teamModalOverlay.classList.add('open');
  }

  teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = teamIdInput.value;
    const payload = {
      name: teamNameInput.value,
      role: teamRoleInput.value,
      tag: teamTagInput.value,
      image: teamImageInput.value
    };

    try {
      if (id) {
        await api('/api/team/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/team', { method: 'POST', body: JSON.stringify(payload) });
      }
      teamModalOverlay.classList.remove('open');
      loadTeam();
      loadLogs();
    } catch (err) {
      alert('Gagal menyimpan: ' + err.message);
    }
  });

  /* ── Team Delete Modal ── */
  const teamDeleteOverlay = document.getElementById('team-delete-overlay');
  const teamDeleteName = document.getElementById('team-delete-name');
  let teamDeleteId = null;

  function openTeamDeleteModal(id, name) {
    teamDeleteId = id;
    teamDeleteName.textContent = name;
    teamDeleteOverlay.classList.add('open');
  }

  document.getElementById('team-delete-close').addEventListener('click', () => teamDeleteOverlay.classList.remove('open'));
  document.getElementById('team-delete-cancel').addEventListener('click', () => teamDeleteOverlay.classList.remove('open'));

  document.getElementById('team-delete-confirm').addEventListener('click', async () => {
    if (!teamDeleteId) return;
    try {
      await api('/api/team/' + teamDeleteId, { method: 'DELETE' });
      teamDeleteOverlay.classList.remove('open');
      loadTeam();
      loadLogs();
    } catch (err) {
      alert('Gagal menghapus: ' + err.message);
    }
  });

  /* ── Logout ── */
  document.getElementById('logout-btn').addEventListener('click', () => {
    window.location.href = '/login.html';
  });

  /* ── Helpers ── */
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function formatDate(dt) {
    if (!dt) return '-';
    const d = new Date(dt);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ── Init ── */
  loadMembers();
  loadLogs();
  loadTeam();
})();
