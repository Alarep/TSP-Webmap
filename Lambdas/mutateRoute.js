const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const randomBytes = require('crypto').randomBytes;

/*
 * Parts of this are already in working order, and
 * other parts (marked by "FILL THIS IN") need to be
 * done by you.
 * 
 * For reference, here's a list of all the functions that
 * you need to complete:
 * - `getDistanceData()`  - DONE
 * - `getRouteById()`     - DONE
 * - `generateChildren()` - DONE
 * - `addOneToGen()`      - DONE
 * - `recordChildren()`   - DONE
 * - `returnChildren`     - 
 * - `computeDistance`    - DONE
 */

// This will be called in response to a POST request.
// The routeId of the "parent" route will be
// provided in the body, along with the number
// of "children" (mutations) to make.
// Each child will be entered into the database,
// and we'll return an array of JSON objects
// that contain the "child" IDs and the length
// of those routes. To reduce computation on the
// client end, we'll also sort these by length,
// so the "shortest" route will be at the front
// of the return array.
//
// Since all we'll get is the routeId, we'll need
// to first get the full details of the route from
// the DB. This will include the generation, and
// we'll need to add one to that to create the
// generation of all the children.
exports.handler = (event, context, callback) => {
    const requestBody = JSON.parse(event.body);
    const routeId = requestBody.routeId;
    const numChildren = requestBody.numChildren;
    let lengthStoreThreshold = requestBody.lengthStoreThreshold;
    if (lengthStoreThreshold == null) {
        lengthStoreThreshold = Infinity;
    }
    
    // Batch writes in DynamoDB are restricted to at most 25 writes.
    // Because of that, I'm limiting this Lambda to only only handle
    // at most 25 mutations so that I can write them all to the DB
    // in a single batch write.
    //
    // If that irks you, you could create a function that creates
    // and stores a batch of at most 25, and then call it multiple
    // times to create the requested number of children. 
    if (numChildren > 25) {
        errorResponse("You can't generate more than 25 mutations at a time", context.awsRequestId, callback);
        return;
    }

    // Promise.all makes these two requests in parallel, and only returns
    // it's promise when both of them are complete. That is then sent
    // into a `.then()` chain that passes the results of each previous
    // step as the argument to the next step.
    Promise.all([getDistanceData(), getRouteById(routeId)])
        .then(([distanceData, parentRoute]) => generateChildren(distanceData.Item, parentRoute.Item, numChildren))
        .then(children => recordChildren(children, lengthStoreThreshold))
        .then(children => returnChildren(callback, children))
        .catch(err => {
            console.log("Problem mutating given parent route");
            console.error(err);
            errorResponse(err.message, context.awsRequestId, callback);
        });
};

// Get the city-distance object for the region 'Minnesota'.
function getDistanceData() {
    return ddb.get({
        TableName: 'distance_data',
        Key: {region: 'Minnesota'}, //grabs the object from the first table
    }).promise();
}

// Get the full info for the route with the given ID.
function getRouteById(routeId) {
    return ddb.get({
        TableName: 'routes',
        Key: {
            "routeId": routeId
            },
    }).promise();
}

// Generate an array of new routes, each of which is a mutation
// of the given `parentRoute`. You essentially need to call
// `generateChild` repeatedly (`numChildren` times) and return
// the array of the resulting children. `generateChild` does
// most of the heavy lifting here, and this function should
// be quite short.
function generateChildren(distanceData, parentRoute, numChildren) {
    // return Array(numChildren).fill().map(generateChild(distanceData, parentRoute));
    let mutts = [];
    
    for (let i = 0; i < numChildren; i++) {
        mutts.push(generateChild(distanceData, parentRoute))
    }
    
    return mutts;
}

// This is complete and you shouldn't need to change it. You
// will need to implement `computeDistance()` and `addOneToGen()`
// to get it to work, though.
function generateChild(distanceData, parentRoute) {
    const oldPath = parentRoute.route;
    const numCities = oldPath.length;
    // These are a pair of random indices into the path s.t.
    // 0<=i<j<=N and j-i>2. The second condition ensures that the
    // length of the "middle section" has length at least 2, so that
    // reversing it actually changes the route. 
    const [i, j] = genSwapPoints(numCities);
    // The new "mutated" path is the old path with the "middle section"
    // (`slice(i, j)`) reversed. This implements a very simple TSP mutation
    // technique known as 2-opt (https://en.wikipedia.org/wiki/2-opt).
    const newPath = 
        oldPath.slice(0, i)
            .concat(oldPath.slice(i, j).reverse(), 
                    oldPath.slice(j));
    const len = computeDistance(distanceData.distances, newPath);
    const child = {
        routeId: newId(),
        runGen: addOneToGen(parentRoute.runGen),
        route: newPath,
        len: len,
    };
    return child;
}

// Generate a pair of random indices into the path s.t.
// 0<=i<j<=N and j-i>2. The second condition ensures that the
// length of the "middle section" has length at least 2, so that
// reversing it actually changes the route. 
function genSwapPoints(numCities) {
    let i = 0;
    let j = 0;
    while (j-i < 2) {
        i = Math.floor(Math.random() * numCities);
        j = Math.floor(Math.random() * (numCities+1));
    }
    return [i, j];
}

// Take a runId-generation string (`oldRunGen`) and
// return a new runId-generation string
// that has the generation component incremented by
// one. If, for example, we are given 'XYZ#17', we
// should return 'XYZ#18'.  
function addOneToGen(oldRunGen) {
    
    
    const stringLen = oldRunGen.length;
    const sym = oldRunGen.indexOf("#");
    
    const runId = oldRunGen.substring(0, sym);
    const genStr = oldRunGen.substring(sym + 1, stringLen);
    
    const genNum = Number(genStr);
    const incrementGen = genNum + 1;
    
    const incKey = runId + '#' + incrementGen;
    
    return incKey;
}

// Write all the children whose length
// is less than `lengthStoreThreshold` to the database. We only
// write new routes that are shorter than the threshold as a
// way of reducing the write load on the database, which makes
// it (much) less likely that we'll have writes fail because we've
// exceeded our default (free) provisioning.
function recordChildren(children, lengthStoreThreshold) {
    
    // Get just the children whose length is less than the threshold.
    const childrenToWrite
        = children.filter(child => child.len < lengthStoreThreshold);
    
    var childJSON = {
        RequestItems: {
            'routes': []
            
        }
    };
    
    // childrenToWrite.foreach instead. Better for JS whereas this for loop looks more like Java
    for (let i = 0; i < childrenToWrite.length; i++){
    
        childJSON.RequestItems['routes'].push({
            PutRequest: {
                Item: childrenToWrite[i],
            }
        });
    }
    
    ddb.batchWrite(childJSON, function(err, data) {
        if (err) console.log(err);
        else console.log(data);
    });
    return childrenToWrite;
}

// Take the children that were good (short) enough to be written
// to the database. 
//
//   * You should "simplify" each child, converting it to a new
//     JSON object that only contains the `routeId` and `len` fields.
//   * You should sort the simplified children by length, so the
//     shortest is at the front of the array.
//   * Use `callback` to "return" that array of children as the
//     the result of this Lambda call, with status code 201 and
//     the 'Access-Control-Allow-Origin' line. 
function returnChildren(callback, children) {
    
    let childrenSorted = children.sort(sortByProperty("len"));
    
    for (let i = 0; i < childrenSorted.length; i++){
        delete childrenSorted[i].route;
        delete childrenSorted[i].runGen;
    }
    
    callback(null, {
                statusCode: 201,
                body: JSON.stringify(childrenSorted),
                headers: {
                    'Access-Control-Allow-Origin': '*'
                }
            });    
}


// Taken from https://medium.com/@asadise/sorting-a-json-array-according-one-property-in-javascript-18b1d22cd9e9
// Method used to sort based on the provided property of the JSON obj
function sortByProperty(property){  
   return function(a,b){  
      if(a[property] > b[property])  
         return 1;  
      else if(a[property] < b[property])  
         return -1;  
  
      return 0;  
   }  
}

// Compute the length of the given route.
function computeDistance(distances, route) {
    
    let totalDistance = 0;
    
    for (let i = 0; i < route.length; i++){
        if (i == route.length-1){
            const finalCity = route[i];
            const startCity = route[0];
            const homeTripDistance = distances[finalCity][startCity];
            totalDistance = totalDistance + homeTripDistance;
        }
        else {
            const city1 = route[i];
            const city2 = route[i+1];
            const aDistance = distances[city1][city2];
            totalDistance = totalDistance + aDistance;
        }
    }
    return totalDistance;
}

function newId() {
    return toUrlString(randomBytes(16));
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
