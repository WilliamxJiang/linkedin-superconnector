// background.js
import { updateScrapedData, datasetNameExists, getRemainingScrapes } from "./functions.js";

chrome.runtime.onInstalled.addListener(() => {
    console.log('background.js loaded')
})

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    await chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
        
        const sendResponse = async (tabId, request) => {
            await chrome.tabs.sendMessage(tabId, request)
        }
        
        console.log('tabId', sender.tab.id)
        
        const sender_id = sender.tab.id
        const action = request.action
        
        switch(action){

            case 'refresh':
                await sendResponse(sender_id, {action}) 
                break;

            case 'test':
                console.log('test', request)
                await sendResponse(sender_id, {action, data: {test: 'this is a test from background.js'}})
                break;
                
            default:
                // await sendResponse(sender_id, request)
                break;
        }
        
        // console.log(request)
        
    })
    }

);
