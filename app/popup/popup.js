const main = () => {
    const test = document.querySelector('button')
    test.addEventListener('click', async () => {
        // send message to content.js
        await chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
            const tabId = tabs[0].id
            await chrome.tabs.sendMessage(tabId, {action: 'test', msg: 'This is a test from popup.js'})
        })
        console.log('button clicked')
    })
}

main()