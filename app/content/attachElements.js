const NUM_IFRAMES = 1
const IFRAME_ELEMENTS = []

let CONNECTIONS_IFRAME = null

// wait for window to load
window.addEventListener("load", async () => {

    const attachElements = () => {
        // if url is not linkedin, return
        if (!window.location.href.includes("linkedin.com")) return;

        const container = document.createElement('mapper-container')
        container.id = 'mapper-container'
        document.body.appendChild(container)
    
        for (let i = 0; i < NUM_IFRAMES; i++) {
            const iframe = document.createElement('iframe')
            iframe.id = `mapper-iframe-${i+1}`
            iframe.className = 'mapper-iframe'
            iframe.src = `https://www.linkedin.com/search/results/people/?page=${i+1}`
            container.appendChild(iframe)
            IFRAME_ELEMENTS.push(iframe)
        }

        CONNECTIONS_IFRAME = document.createElement('iframe')
        CONNECTIONS_IFRAME.id = 'connected-iframe'
        CONNECTIONS_IFRAME.className = 'mapper-iframe'
        CONNECTIONS_IFRAME.src = `https://www.linkedin.com/mynetwork/invite-connect/connections/`
        container.appendChild(CONNECTIONS_IFRAME)
    }
    
    attachElements()
})
