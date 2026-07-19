// Mobile-friendly layout implementation
// Breakpoint consistent with CSS media query (769px)
const MAX_MOBILE_WIDTH = 768;
const STORAGE_KEY = 'mobile-layout-preference';

/**
 * Detects if current viewport is mobile-sized
 */
function isMobileViewport() {
  return window.innerWidth <= MAX_MOBILE_WIDTH;
}

/**
 * Gets user's saved preference from localStorage
 * Returns: 'mobile' | 'desktop' | null (no preference set)
 */
function getSavedPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Unable to access localStorage:', e);
    return null;
  }
}

/**
 * Saves user's preference to localStorage
 */
function savePreference(preference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch (e) {
    console.warn('Unable to save to localStorage:', e);
  }
}

/**
 * Applies the mobile layout attribute to the body element
 */
function applyLayout(forceMobile) {
  const shouldUseMobileLayout = forceMobile !== undefined 
    ? forceMobile 
    : isMobileViewport();
  
  if (shouldUseMobileLayout) {
    document.body.setAttribute('data-mobile-layout', 'true');
  } else {
    document.body.removeAttribute('data-mobile-layout');
  }
}

/**
 * Initializes the layout based on saved preference or viewport
 */
function initializeLayout() {
  const savedPreference = getSavedPreference();
  
  if (savedPreference === 'mobile') {
    applyLayout(true);
  } else if (savedPreference === 'desktop') {
    applyLayout(false);
  } else {
    // No preference saved, use viewport detection
    applyLayout(isMobileViewport());
  }
}

/**
 * Debounce function for resize events
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Handles window resize events
 * Only updates layout if no explicit user preference is set
 */
const handleResize = debounce(() => {
  const savedPreference = getSavedPreference();
  if (savedPreference === null) {
    applyLayout(isMobileViewport());
  }
}, 250);

/**
 * Public API to toggle mobile layout
 * Can be called from other parts of the application
 * @param {boolean} forceMobile - true to force mobile, false to force desktop, undefined to auto-detect
 */
window.toggleMobileLayout = function(forceMobile) {
  if (forceMobile === true) {
    savePreference('mobile');
    applyLayout(true);
  } else if (forceMobile === false) {
    savePreference('desktop');
    applyLayout(false);
  } else {
    // Toggle based on current state or clear preference
    const currentLayout = document.body.getAttribute('data-mobile-layout');
    if (currentLayout === 'true') {
      savePreference('desktop');
      applyLayout(false);
    } else {
      savePreference('mobile');
      applyLayout(true);
    }
  }
};

/**
 * Public API to reset to auto-detect mode
 */
window.resetMobileLayout = function() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Unable to clear localStorage:', e);
  }
  applyLayout(isMobileViewport());
};

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('CodeForge project loaded!');
  initializeLayout();
});

// Listen for resize events
window.addEventListener('resize', handleResize);

// Listen for preference changes across tabs (if supported)
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    initializeLayout();
  }
});
