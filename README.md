# mqttDataKeeper

Small daemon, which save all data coming to MQTT broker in MongoDB.

If MongoDB is unavailable, data will be stored in NeDB. After restoring connection with Mongo, all data will be moved there.

```
"router": [{...}, {...}, ...]

{
	"topic": "myHome/temp/indoor",  // MQTT topic
	"collection": "temperature",    // MongoDB collection for save messages
	"type": "float",                // Data type (optional parameter - if not specified, it is determined automatically)
	"name": "indoor",               // Key name in collection
	"accuracy": 0.2,                // Measurement error within which data are not recorded in the database
	"interval": 60                  // The period of time (in seconds) after which the received data is entered into the database, even if it is still within `accuracy` range (a kind of "keep alive")
}
```

### Release notes

*1.0.2*
- Added description of daemon
- Added new parameter `interval` in MQTT-routing messages
- Added ability to specify additional connection options to MQTT-broker

*1.0.1*
- Fix autocreate NeDB directory if doesn't exist

### TODO

- Use templates in routes.
