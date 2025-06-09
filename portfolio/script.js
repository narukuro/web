document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');

  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
  });
});
