const sidebar = document.querySelector('[data-sidebar]');
const sidebarToggle = document.querySelector('[data-sidebar-toggle]');
const sidebarClose = document.querySelector('[data-sidebar-close]');

function setSidebar(open) {
  document.body.classList.toggle('is-sidebar-open', open);
  if (sidebar) sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
}

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => setSidebar(!document.body.classList.contains('is-sidebar-open')));
}

if (sidebarClose) {
  sidebarClose.addEventListener('click', () => setSidebar(false));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSidebar(false);
});
