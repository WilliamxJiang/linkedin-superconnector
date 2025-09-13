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

            startAutoClickLoadMore({ text: "load more", partial: false, interval: 1200 }, CONNECTIONS_IFRAME);
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

  })