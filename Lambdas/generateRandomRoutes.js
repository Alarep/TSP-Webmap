const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const randomBytes = require('crypto').randomBytes;
exports.handler = (event, context, callback) => {

    const requestBody = JSON.parse(event.body);
    const runId = requestBody.runId;
    const generation = requestBody.generation;
    const numToReturn = requestBody.numToReturn;
    
    generateRandomRoute(runId, generation, callback);

}
function generateRandomRoute(runId, generation, callback, partitionKey){
    getCityData().then(minnesotaObject =>{
        
        const minnesotaObjectData = JSON.stringify(minnesotaObject.Item.cities);
        const cityDistances = minnesotaObject.Item.distances;
        const minnesotaCities = minnesotaObject.Item.cities;
        
        const arrayOfCities = new Array(); //creating an array with size based on the number of cities
        populateCityArray(arrayOfCities); //now the array has entries [0,1,...,n-1]
        cityRandomizer(arrayOfCities); //randomizing the cities
        console.log(arrayOfCities);
       
        const partitionKey = generatePartitionKey(runId,generation);
        const routeId = toUrlString(randomBytes(16));
        const routeDistance = calculateDistance(arrayOfCities,cityDistances);
        console.log(routeDistance);
        return ddb.put(
        {TableName: 'routes',
        Item: {
        runGen: partitionKey,
        routeId: routeId,
        route: arrayOfCities,
        len: routeDistance},}).promise().then(dbResults => {
            const generatedRoute = dbResults.Item;
            callback(null, {
                statusCode: 201,
                body: JSON.stringify({
                    routeId: routeId,
                    length: routeDistance,
                }),
                headers: {
                    'Access-Control-Allow-Origin': '*'
                }
            });
        });
    
    // return {
    //     //runId: runId,
    //     //generation: generation,
    //     routeId: routeId,
    //     length: routeDistance,
    // }
    });
}
/*
Gets the 'Minnesota' object from the first table/database. The object
includes the cities and their distances from each other
*/
function getCityData() {
    return ddb.get({
        TableName: 'distance_data',
        Key: {region: 'Minnesota'}, //grabs the object from the first table
    }).promise();
}
function calculateDistance(array, cityDistances){ //takes in an array that should be randomized
    let totalDistance = 0;
    for (let i = 0; i < array.length; i++){
        if (i == array.length-1){
            const finalCity = array[i];
            const startCity = array[0];
            const homeTripDistance = cityDistances[finalCity][startCity];
            totalDistance = totalDistance + homeTripDistance;
        }
        else {
            const city1 = array[i];
            const city2 = array[i+1];
            const aDistance = cityDistances[city1][city2];
            totalDistance = totalDistance + aDistance;
        }
        console.log(totalDistance);
    }
    return totalDistance;
}
/*
Populates an array with numbers 0-(n-1)
*/
function populateCityArray(array){
    for (let i=0; i < 11; i++){
        array[i] = i;
    }
}
function cityRandomizer(array){
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
}
function generatePartitionKey(runId, generation){
    return runId + '#' + generation;
}
function toUrlString(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
function errorResponse(errorMessage, awsRequestId, callback) {
  callback(null, {
    statusCode: 500,
    body: JSON.stringify({
      Error: errorMessage,
      Reference: awsRequestId,
    }),
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}