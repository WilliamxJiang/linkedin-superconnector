// === Loading overlay with progress bar ===
function showNetworkLoadingBar(durationMs = 5000, bgColor = '#0b1020') {
  const LOADER_ID = 'network-viz-loading-overlay';
  const EXISTING = document.getElementById(LOADER_ID);
  if (EXISTING) EXISTING.remove();

  // Container
  const overlay = document.createElement('div');
  overlay.id = LOADER_ID;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: ${bgColor};
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Bar wrapper
  const barWrap = document.createElement('div');
  barWrap.style.cssText = `
    width: min(560px, 80vw);
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 999px;
    overflow: hidden;
    backdrop-filter: blur(2px);
    box-shadow: 0 6px 30px rgba(0,0,0,0.35);
  `;

  // Fill
  const barFill = document.createElement('div');
  barFill.style.cssText = `
    height: 14px;
    width: 0%;
    border-radius: 999px;
    background: linear-gradient(90deg, #5aa9ff, #8bc6ff);
    transition: width ${durationMs}ms linear;
  `;

  // Optional label
  const label = document.createElement('div');
  label.textContent = 'Preparing network visualizer…';
  label.style.cssText = `
    color: #e8eefc;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 12px;
    text-align: center;
    opacity: 0.9;
  `;

  const stack = document.createElement('div');
  stack.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
  `;

  barWrap.appendChild(barFill);
  stack.appendChild(label);
  stack.appendChild(barWrap);
  overlay.appendChild(stack);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    barFill.style.width = '100%';
  });

  const endTimer = setTimeout(() => {
    if (overlay.isConnected) overlay.remove();
  }, durationMs + 100);

  return {
    destroy() {
      clearTimeout(endTimer);
      if (overlay.isConnected) overlay.remove();
    },
    el: overlay
  };
}

// Add button to LinkedIn interface
function addNetworkButton() {
  const possibleLocations = [
    '.pv-top-card-v2-ctas',
    '.pv-top-card__actions',
    '.pv-top-card-v2-ctas__container',
    '.pv-top-card__action-buttons',
    '.profile-actions',
    '.pv-top-card__actions-inline',
    '.pv-top-card-v2-ctas__container-inline',
    '.pv-top-card__action-buttons-inline'
  ];
  
  let targetLocation = null;
  for (const selector of possibleLocations) {
    targetLocation = document.querySelector(selector);
    if (targetLocation) {
      console.log('Found target location:', selector);
      break;
    }
  }
  
  if (!targetLocation) {
    const profileSection = document.querySelector('.pv-top-card') || 
                          document.querySelector('.profile-section') || 
                          document.querySelector('main') ||
                          document.querySelector('.scaffold-layout__content');
    
    if (profileSection) {
      const existingContainer = document.getElementById('network-viz-container');
      if (existingContainer) {
        targetLocation = existingContainer;
      } else {
        targetLocation = document.createElement('div');
        targetLocation.id = 'network-viz-container';
        targetLocation.style.cssText = 'margin: 10px 0; padding: 10px; background: #f3f2ef; border-radius: 8px;';
        profileSection.insertBefore(targetLocation, profileSection.firstChild);
        console.log('Created custom container for network button');
      }
    } else {
      console.log('Could not find suitable location for network button');
      return;
    }
  }
  
  if (document.getElementById('network-viz-btn')) return;
  
  const networkBtn = document.createElement('button');
  networkBtn.id = 'network-viz-btn';
  networkBtn.innerHTML = '🌐 Visualize Network';
  networkBtn.style.cssText = `
    background: #0077b5;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    margin: 5px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    display: inline-block;
  `;
  
  networkBtn.onclick = () => {
    openNetworkVisualizer();
  };
  
  targetLocation.appendChild(networkBtn);
  console.log('Network visualizer button added to LinkedIn');
}

function openNetworkVisualizer() {
  try {
    if (!chrome.runtime || !chrome.runtime.getURL) {
      console.error('Extension context invalidated. Please reload the page.');
      alert('Extension context invalidated. Please reload the page and try again.');
      return;
    }

    // Show loading bar for 15 seconds
    const loader = showNetworkLoadingBar(5000, '#0b1020');

    if (typeof window.CONNECTIONS_IFRAME !== 'undefined' && window.CONNECTIONS_IFRAME) {
    //   const intervalId = startAutoClickLoadMore({ text: "load more", partial: false, interval: 1200 }, window.CONNECTIONS_IFRAME);
      
      setTimeout(() => {
        // stopAutoClickLoadMore(intervalId, window.CONNECTIONS_IFRAME);
        loader?.destroy?.();

        const container = document.createElement('div');
        container.id = 'network-visualizer-overlay';
        container.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0,0,0,0.95);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
        `;
        
        const iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL('app/resources/network.html');
        iframe.style.cssText = `
          width: 90vw;
          height: 90vh;
          border: none;
          border-radius: 8px;
          background: #0b1020;
        `;
    
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
          position: absolute;
          top: 20px;
          right: 20px;
          background: #ff4444;
          color: white;
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          font-size: 20px;
          cursor: pointer;
          z-index: 1000000;
        `;
        closeBtn.onclick = () => {
          if (document.body.contains(container)) {
            document.body.removeChild(container);
          }
        };
        
        const handleEscape = (e) => {
          if (e.key === 'Escape') {
            if (document.body.contains(container)) {
              document.body.removeChild(container);
              document.removeEventListener('keydown', handleEscape);
            }
          }
        };
        document.addEventListener('keydown', handleEscape);
        
        container.appendChild(iframe);
        container.appendChild(closeBtn);
        document.body.appendChild(container);
        
        console.log('Network visualizer opened successfully');
      }, 5000); 

    } else {
      console.warn('CONNECTIONS_IFRAME not available yet');
    }
  } catch (error) {
    console.error('Error opening network visualizer:', error);
    alert('Error opening network visualizer. Please try reloading the page.');
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'openNetworkVisualizer') {
      openNetworkVisualizer();
      sendResponse({success: true});
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({success: false, error: error.message});
  }
});

function initialize() {
  console.log('Initializing LinkedIn Network Visualizer...');
  addNetworkButton();
  setTimeout(addNetworkButton, 2000);
  setTimeout(addNetworkButton, 5000);
  
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('LinkedIn navigation detected, re-adding button...');
      setTimeout(addNetworkButton, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
