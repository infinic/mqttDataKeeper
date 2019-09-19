const MQTT = require('async-mqtt');
const { MongoClient } = require('mongodb');
const { Datastore } = require('nedb-async-await');
const fs = require('fs');

const config = require('./config.json');

var ndb = {};
var lastValue = {};
var lastDBValue = {};
var lastDocument = {};

var   MDBclient = new MongoClient(config.MongoDB.url, config.MongoDB.options);
const MQTTclient = MQTT.connect(config.MQTT.url);

MQTTclient.on("connect", async () => {

	console.log(`Connected to MQTT broker '${config.MQTT.url}'.`);
	try {
		await MQTTclient.subscribe(config.MQTT.topic);
		console.log(`Subscribed on topic '${config.MQTT.topic}'.`);
	} catch (e){
		console.log(e.stack);
		process.exit();
	}
});

MQTTclient.on('message', async (topic, message) => {
  
  console.log(`${message.toString()} on topic ${topic}`);

  // Check routes...
  let obj = config.MQTT.router.find(route => route.topic === topic);
  if (obj === undefined && config.MQTT.saveOnlyRoutedMessages) return;

  // Parse data...
  let collection = (obj !== undefined && obj.collection !== undefined) ? obj.collection : config.MongoDB.defaultCollection;
  let dataType = (obj !== undefined ) ? obj.type : undefined;
  let dataName = (obj !== undefined && obj.name !== undefined) ? obj.name : 'data';
  let dataValue = await bring2type(message, dataType);

  // Make document
  let doc = { [dataName]: dataValue, timestamp: new Date() };
  
  // Check data accuracy
  if (obj !== undefined && obj.accuracy !== undefined) {
  	if (lastDBValue[collection] === undefined || lastDBValue[collection][dataName] === undefined) {
  	  // Ok...
  	  if (lastDBValue[collection] === undefined) lastDBValue[collection] = {};
  	  if (lastValue[collection] === undefined) lastValue[collection] = {};
  	  if (lastDocument[collection] === undefined) lastDocument[collection] = {};
  	  lastValue[collection][dataName] = dataValue;
      lastDBValue[collection][dataName] = dataValue;
      lastDocument[collection][dataName] = doc;
    } else if ( Math.abs(dataValue - lastDBValue[collection][dataName]) <= obj.accuracy ) {
  	  // Wait next message
  	  lastValue[collection][dataName] = dataValue;
      lastDocument[collection][dataName] = doc;
  	  return
  	} else {
  	  insertDocument(lastDocument[collection][dataName], collection);
  	  lastValue[collection][dataName] = dataValue;
      lastDBValue[collection][dataName] = dataValue;
      lastDocument[collection][dataName] = doc;
  	}
  }

  // Inset the document
  insertDocument(doc, collection);

});

const insertDocument = async(doc, col) => {
  
  if (MDBclient.isConnected()) {
    try {
      // Insert document into DB
      let res = await MDBclient.db().collection(col).insertOne(doc, {forceServerObjectId: true});
      if (res.insertedCount !== 1) throw('Something wrong...');
      process.stdout.write(`MongoDB: ${col} : `);
      console.log(doc);
    } catch (err) {
	  console.log(`Could not insert document to the MongoDB.`);
	  console.log(err.stack);
	  console.log(`Try insert to NeDB.`);
	  insertOneToNeDB(doc, col);
	}
  } else {
    insertOneToNeDB(doc, col);
  }

}

const insertOneToNeDB = async(doc, col) => {

  if (ndb[col] === undefined ) {
    ndb[col] = new Datastore({ filename: `${config.NeDB.path}/${col}`, autoload: true });
  }
  try {
    let newDoc = await ndb[col].insert(doc);
    process.stdout.write(`NeDB: ${col} : `);
    console.log(doc);
  } catch(err) {
    console.log(`Could not insert document to the NeDB.`);
    console.log(err.stack);
  }

}

const nedb2mongo = async() => {

  let files = fs.readdirSync(config.NeDB.path);

  for (let filename of files) {

    process.stdout.write(`Moving data from NeDB '${filename}' `);
    let db = new Datastore({ filename: `${config.NeDB.path}/${filename}`, autoload: true });

    let docs = await db.find({});

    for (let doc of docs) {
      let id = doc._id;
      delete doc._id;
      try {
        let res = await MDBclient.db().collection(filename).insertOne(doc);
        if (res.insertedCount !== 1) throw('Something wrong...');
        await db.remove({_id: id});
        process.stdout.write('.');
      } catch (err) {
        console.log(' Error!');
        console.log(err.stack);
        console.log(`Break transfer.`);
        return;
	  }
    }
    console.log(' Done!');
	fs.unlinkSync(`${config.NeDB.path}/${filename}`);

  }

}

const connectToMongo = async() => {

  try {
    MDBclient = MongoClient(config.MongoDB.url, config.MongoDB.options);
    await MDBclient.connect();
    console.log(`Connected to MongoDB '${config.MongoDB.url}'.`);

  	// Insert all data from NeDB
  	nedb2mongo();

	MDBclient.on('close', () => { 
		console.log('-> MongoDB: Connection is lost.');
		connectToMongo();
	});
  } catch (err) {
    console.log(`Could not connect to MongoDB '${config.MongoDB.url}'. Retry after ${config.MongoDB.retriesTimeout} second(s).`);
    //console.log(err.stack);
    setTimeout(connectToMongo, config.MongoDB.retriesTimeout*1000);
  }

}

const bring2type = async(str, type = undefined) => {
  
  let tStr = str.toString().trim();
  
  switch (type) {
  	case 'float': 
  	  return parseFloat(str.toString().replace(",", "."));												// Replace ',' to '.' for exception...
    case 'integer':
      return parseInt(str);
    case 'string':
  	  return str.toString();
    case 'bool':
  	  return (tStr === 'true' || (tStr != '0' && tStr != 'null' && tStr != 'undefined') );
  	default:
  	  if (tStr === 'true' || tStr === 'false') return (tStr === 'true');								// Boolean
  	  if (tStr == 'null' || tStr == 'undefined') return null;											// Null
  	  if (!isNaN(tStr.replace(",", "."))) return Number(tStr.replace(",", "."));						// Number
	  if (new Date(tStr) instanceof Date && new Date(tStr) != 'Invalid Date') return new Date(tStr);	// Date
  	  return str.toString();																			// String
  }

}

connectToMongo();
