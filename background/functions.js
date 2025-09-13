// const SERVER = 'http://localhost:8000'

const fetchData = async (method, headers, body, END_POINT) => {
    try {
        const response = await fetch(`${SERVER}/${END_POINT}`,{
            method,
            headers,
            body
        })
        const data = await response.json()
        return data
    } catch (e) {
        console.log(e)
        return false
    }
}

// Add scraped data to db
const updateScrapedData = async (userID, dataset_name, results) => {
    const path = 'process-scraped-data'
    const method = "POST"
    const headers =  {'Content-type': 'application/json'}
    const body =  JSON.stringify({userID, dataset_name, results})
    
    return await fetchData(method, headers, body, path)
}

// Check if dataset name exists in database
const datasetNameExists = async (userID, dataset_name) => {
    const path = 'check-dataset-exists'
    const method = "POST"
    const headers =  {'Content-type': 'application/json'}
    const body = JSON.stringify({userID, dataset_name})
    
    return await fetchData(method, headers, body, path)
}

const getRemainingScrapes = async (userID) => {
    const path = `get-remaining-scrapes/${userID}`
    const method = "GET"
    const headers =  {'Content-type': 'application/json'}
    // const body = JSON.stringify({userID})
    
    return await fetchData(method, headers, null, path)
}



export { updateScrapedData, datasetNameExists, getRemainingScrapes }