import { MongoClient } from 'mongodb';
import { PubSub } from '@google-cloud/pubsub';
import avro from 'avro-js';
import fs from 'fs';

// Change these before running.
const MONGODB_URI = 'mongodb+srv://tuangimasys:khigia1993@mongodb.d7vjqq1.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';
const PUB_SUB_TOPIC = 'projects/gms-rd-smartanalytics/topics/MongoDBCDC';

let mongodbClient;
try {
    mongodbClient = new MongoClient(MONGODB_URI);
    await monitorCollectionForInserts(mongodbClient, 'sample_analytics', 'customers');
} finally {
    mongodbClient.close();
}

async function monitorCollectionForInserts(client, databaseName, collectionName, timeInMs) {
    const collection = client.db(databaseName).collection(collectionName);

    // An aggregation pipeline that matches on new documents in the collection.
    const pipeline = [ { $match: { operationType: { $in: ['update', 'insert', 'delete'] } } } ];
    const changeStream = collection.watch(pipeline);
    console.log(`Watching for changes in '${databaseName}.${collectionName}'...`);

    changeStream.on('change', event => {
        const document = event.fullDocument;
        publishDocumentAsMessage(document, PUB_SUB_TOPIC);
    });

    await closeChangeStream(timeInMs, changeStream);
}

function closeChangeStream(timeInMs = 60000, changeStream) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log('Closing the change stream');
            changeStream.close();
            resolve();
        }, timeInMs)
    })
};

async function publishDocumentAsMessage(document, topicName) {
    const pubSubClient = new PubSub();
    const topic = pubSubClient.topic(topicName);

    const definition = fs.readFileSync('./document-message.avsc').toString();
    const type = avro.parse(definition);

    const message = {
        id: document?._id?.toString(),
        source_data: JSON.stringify(document),
        Timestamp: new Date().toISOString(),
    };

    const dataBuffer = Buffer.from(type.toString(message));
    try {
        const messageId = await topic.publishMessage({ data: dataBuffer });
        console.log(`Avro record ${messageId} published.`);
    } catch(error) {
        console.error(error);
    }
}
