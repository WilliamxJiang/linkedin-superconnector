// Add button to LinkedIn interface
function addNetworkButton() {
  // Look for different possible locations on LinkedIn
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
    // Try to find any button container or create our own
    const profileSection = document.querySelector('.pv-top-card') || 
                          document.querySelector('.profile-section') || 
                          document.querySelector('main') ||
                          document.querySelector('.scaffold-layout__content');
    
    if (profileSection) {
      // Create our own container
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
  
  // Check if button already exists
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
    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.getURL) {
      console.error('Extension context invalidated. Please reload the page.');
      alert('Extension context invalidated. Please reload the page and try again.');
      return;
    }

    // Create overlay container
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
    
    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('app/resources/network.html');
    iframe.style.cssText = `
      width: 90vw;
      height: 90vh;
      border: none;
      border-radius: 8px;
      background: #0b1020;
    `;
  
    // Close button
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
    
    // Escape key to close
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
  } catch (error) {
    console.error('Error opening network visualizer:', error);
    alert('Error opening network visualizer. Please try reloading the page.');
  }
}

// Listen for messages from popup
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

// Wait for LinkedIn to load and add button
function initialize() {
  console.log('Initializing LinkedIn Network Visualizer...');
  
  // Try to add button immediately
  addNetworkButton();
  
  // Also try after a delay in case LinkedIn is still loading
  setTimeout(addNetworkButton, 2000);
  setTimeout(addNetworkButton, 5000);
  
  // Watch for navigation changes (LinkedIn is a SPA)
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

// Initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}