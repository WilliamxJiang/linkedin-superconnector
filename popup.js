document.getElementById('openNetwork').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    // Send a message to the content script to open the network visualizer
    chrome.tabs.sendMessage(tabs[0].id, {action: 'openNetworkVisualizer'}, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Error sending message:', chrome.runtime.lastError);
        // Fallback: try to inject the script
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => {
            // Trigger the network visualizer
            const event = new CustomEvent('openNetworkVisualizer');
            document.dispatchEvent(event);
          }
        });
      }
    });
  });
});

// Check if we're on LinkedIn
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const url = tabs[0].url;
  const status = document.getElementById('status');
  
  if (url.includes('linkedin.com')) {
    status.textContent = 'Ready to visualize networks';
    status.style.background = '#f0f8ff';
  } else {
    status.textContent = 'Please navigate to LinkedIn first';
    status.style.background = '#fff3cd';
  }
});