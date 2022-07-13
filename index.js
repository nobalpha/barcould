/*
TODO:
GridFSBucket image storage
*/

const mammoth = require("mammoth");
const htmlToDoc = require("html-to-docx");
const express = require("express");
const {Readable} = require("stream");
const { QRCodeStyling } = require("qr-code-styling-node/lib/qr-code-styling.common.js");
const nodeCanvas = require("canvas");
const { JSDOM } = require("jsdom");
const { MongoClient, ObjectID } = require("mongodb");
const fs = require("fs");
const path = require("path");
const app = express();

const PORT = 3000;
const URI = "mongodb://localhost:27017";

const client = new MongoClient(URI);
const database = client.db("kbarcode");


// TODO da fuq!!!?!
Array.prototype.chunkBy = function (step, key) {
	let out = [];
	for (let i = r = j = c = 0; i < this.length;) {
		/*
			quantity > step: stay on the current object, trim it and move on next index on out
			
			quantity == step: move to the next object and move on next index on out
			
			quantity < step: move to the next object and stay on the current index on out
		*/
		// c -> current out array quantity
		r = r || this[i][key]; // remained/to be processed quantity
		out[j] = out[j] || [];
		future = c + r; // future out array quantity
		k = i % (out[j].length + 1); // avoiding having empty array indexes
		
		if (future > step) { // if future stack higher than chunk size
			out[j][k] = {...this[i], [key]: step - c}; // setting to the last possible quantity
			r = r - step + c; // decrease the processed quantity
			c = 0; // passing to other future array index
			j++;
		} else if (future < step) { // if future stack lesser than chunk size
			out[j][k] = {...this[i], [key]: r}; // loading all we have 
			c = r; // updating current stack
			r = 0; // emptying input stack
			i++; // passing to the other subindex
		} else { // if it's squared
			out[j][k] = {...this[i], [key]: r}; // loading all we have
			r = 0; // no input stack
			c = 0; // no current stack
			j++; // passing to the other out array index
			i++; // passing to the other subindex
		}
		
	}
	return out;
};


app.use(express.json({limit: '20MB'}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
  res.render("dashboard");
})

app.get("/attributes", async (req, res) => {
	const attributes = await queryDB( async () => {
		const attributes = database.collection('attributes');
		const query = {};
		const attr = await attributes.find().toArray();
		return attr;
	});
	
	res.render("attributes", {attributes:attributes});
});

app.post("/attributes", async (req, res) => {
	console.log(req.body);
	await queryDB( async () => {
		const attributes = database.collection('attributes');
		const query = {key: req.body.key};
		await attributes.updateOne(query,  {$push: {data: {name: req.body.name, code:req.body.code}}});
	});
});

app.get("/entry", async (req, res) => {
	const attributes = await queryDB( async () => {
		const attributes = database.collection('attributes');
		const query = {};
		const attr = await attributes.find().toArray();
		return attr;
	});
	console.log(attributes);
	res.render("entry", {attributes:attributes});
});


app.post("/entry", async (req, res) => {
	
	
	const {stockCode, product, quantity, model, season, leather, color, accessory} = req.body;
	if (!stockCode || !product || !quantity || !model || !season || !leather || !color || !accessory) return;
	
	await queryDB( async () => {
		const stock = database.collection('stock');
		const query = {code: stockCode};
		const update = {
			$set: {code: stockCode, product: product, model:model, season:season, leather:leather, accessory:accessory, color:color, last_registered: new Date().toISOString()},
			$inc: {quantity: parseInt(quantity)},
			$setOnInsert: {image: "", printed: 0, last_printed: null}
		};
		const options = {upsert: true};
		stock.updateOne(query, update, options);
	});
	
	// generateQRCode();
	
	res.sendStatus(200);
	
});

app.post("/stock", async (req, res) => { // accept also changes on the stock table
	if (!req.body.id) return res.sendStatus(404);
	/*const stream = Readable.from(buffer.toString());
	await queryDB( async () => {
		const bucket = new GridFSBucket(database, {bucketName: "images"});
		console.log(bucket);
		return;
		stream.pipe(bucket.openUplaodStream("image", {
			chunkSizeBytes: 1048576,
			contentType: req.body.type,
			id: req.body.id
		}))
		const cursor = bucket.find({id: req.body.id});
		cursor.forEach(doc => console.log(doc));
	});*/
	if (req.body.src !== undefined) {
		await queryDB( async () => {
			const stock = database.collection('stock');
			const query = {_id: ObjectID(req.body.id)};
			const update = {
				$set: {image: req.body.src},
			};
			await stock.updateOne(query, update);
		});
		return res.sendStatus(200);
	}
	
	if (req.body.field !== undefined && req.body.data) {
		console.log(req.body);
		const field = req.body.field;
		await queryDB( async () => {
			const stock = database.collection('stock');
			const query = {_id: ObjectID(req.body.id)};
			console.log(field);
			const update = {
				$set: {[field]: parseFloat(req.body.data) || req.body.data},
			};
			await stock.updateOne(query, update);
		});
		return res.sendStatus(200);
	}
	
	return res.sendStatus(404);
});

app.get("/stock", async (req, res) => {
	const stock = await queryDB( async () => {
		const stock = database.collection('stock');
		const stc = await stock.find().toArray();
		return stc;
	});
	res.render("stock", {stock: stock});
});

app.get("/press", async (req, res) => {
	const toBePrinted = await queryDB( async () => {
		const stock = database.collection('stock');
		const query = { $where: "this.quantity > this.printed"};
		const stc = await stock.find(query).project({_id: 1, code: 1, quantity: 1, printed: 1}).toArray();
		return stc;
		
	});
	const chunked = toBePrinted.chunkBy(3, "quantity");
	mammoth.convertToHtml({path: "./label.docx"}).then(async (res) => {
		const html = res.value;
		const messages = res.messages;
		console.log(messages)
		console.log(html);
		fs.writeFileSync("./test.docx", await htmlToDoc(html))
		 
	}).done();
	return res.render("press", {stock: chunked});
});

app.post("/press", (req, res) => {
	console.log(req.body);
});

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`)
})

const queryDB = async (func) => {
	await client.connect();
	
	return await func();
};

const generateQRCode = () => {
	
	const options = {
        width: 300,
        height: 300,
        type: "svg",
        data: "https://www.facebook.com/",
        image: "https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg",
        dotsOptions: {
            color: "#4267b2",
            type: "rounded"
        },
        backgroundOptions: {
            color: "#e9ebee",
        },
        imageOptions: {
            crossOrigin: "anonymous",
            margin: 20
        }
    };
	
	const qrCode = new QRCodeStyling({jsdom: JSDOM, type:"svg", ...options});
	
	// console.log(qrCode);
	
    qrCode.getRawData("svg").then((buffer) => {
		console.log(buffer);
		fs.writeFileSync("test.svg", buffer);
	});
	return qrCode;
	
};

/*
stock:

[image] stockCode product modelName season leather color quantity printed last_registered last_printed


press: (Ready to print)

group (quantity - printed) by 18
 */