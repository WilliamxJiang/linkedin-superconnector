console.log("Mapper: _____content.js_____ loaded");

// const api_url = 'http://localhost:8080'

// ------------------------------------------ Event Listeners -------------------------------------------- //

// wait for window to load
window.addEventListener("load", async () => {
    
    // __________________________________________PORT FOR SERVICE WORKER__________________________________________
    await chrome.runtime.onMessage.addListener(
      function(request, sender, sendResponse) {
        const action = request.action
        
        switch(action){

          case 'refresh':
            setTimeout(()=>{
              sendMessage('refresh')
              console.log('refreshed content.js')
            }, 18000)
            break;
          case 'test':
            // console.log('test', request)
            // console.log(IFRAME_ELEMENTS[0].contentWindow.document)

            // const profiles = scrapeProfiles(IFRAME_ELEMENTS[0].contentWindow.document)
            // console.log(profiles)
            // console.log(scrapeProfiles())

            // Check if CONNECTIONS_IFRAME is available before using it
            if (typeof window.CONNECTIONS_IFRAME !== 'undefined' && window.CONNECTIONS_IFRAME) {
              startAutoClickLoadMore({ text: "load more", partial: false, interval: 1200 }, window.CONNECTIONS_IFRAME);
            } else {
              console.warn('CONNECTIONS_IFRAME not available yet');
            }
            break
          default:
            break;
        }
      }
    );

    const sendMessage = async (msg) => {
      try {
        await chrome.runtime.sendMessage(msg)
      } catch (e){
        return false
      }
      return true
    }

    
    await sendMessage({action: 'refresh'})

    // ------------------------------------------ Attach Elements -------------------------------------------- //

    setTimeout(async () => {
      // check if 
      // check if the local storage is 120 or more profiles
      const { 'lsc-latest-profiles': profiles } = await chrome.storage.local.get(['lsc-latest-profiles'])
      if (profiles && profiles.length >= 120) {
        console.log('Already have 120 or more profiles, not attaching iframes.')
        return
      }
      if (typeof window.CONNECTIONS_IFRAME !== 'undefined' && window.CONNECTIONS_IFRAME) {
        startAutoClickLoadMore({ text: "load more", partial: false, interval: 1200, limit: 120}, window.CONNECTIONS_IFRAME);
      } else {
        console.warn('CONNECTIONS_IFRAME not available yet');
      }
    }, 3000)

  })