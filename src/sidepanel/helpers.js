/**
 * X Unfollower — Side Panel Helper Functions
 */

export function showToast(container, message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatNumber(num) {
  if (typeof num !== 'number') return '—';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

export function getBadgeClass(status) {
  switch (status) {
    case 'not-following-back': return 'badge-red';
    case 'mutual': return 'badge-green';
    default: return '';
  }
}

export function getBadgeText(status) {
  switch (status) {
    case 'not-following-back': return '不互关';
    case 'mutual': return '互关';
    default: return '';
  }
}

/**
 * Blue V verified badge SVG markup
 */
export function blueCheckSvg() {
  return `<svg class="blue-check" viewBox="0 0 22 22" width="16" height="16">
    <path fill="#1D9BF0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.143.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.569.646-.018 1.273-.215 1.814-.569.54-.354.97-.853 1.246-1.439.616.226 1.282.272 1.92.14.637-.134 1.22-.44 1.664-.888.442-.444.748-1.028.88-1.664.131-.637.085-1.304-.14-1.92.585-.275 1.084-.706 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/>
  </svg>`;
}

/**
 * Debounce function
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
