"use strict";
var builder = require("botbuilder");
var botbuilder_azure = require("botbuilder-azure");
var websocket = require("websocket");

var useConsole = false;
var useEmulator = (process.env.NODE_ENV == 'development');
var fetch = require('node-fetch');
var verboseOutput = false;
var socketList = [];


var connector;

if (useConsole == false) {
    connector = useEmulator ? new builder.ChatConnector() : new botbuilder_azure.BotServiceConnector({
        appId: process.env['MicrosoftAppId'],
        appPassword: process.env['MicrosoftAppPassword'],
        stateEndpoint: process.env['BotStateEndpoint'],
        openIdMetadata: process.env['BotOpenIdMetadata']
    });
} else {
    connector = new builder.ConsoleConnector().listen();
}

var bot = new builder.UniversalBot(connector);

var intents = new builder.IntentDialog();
bot.dialog("/", intents);

// configuration info, TODO: load a default config from external source? Load config based on user connecting?
var botConfig = [];
var currentBot = null; // which child bot are we talking to

loadBots();

function loadBots() {
    const bots = [{
            botName: 'quote-bot-demo',
            botSecret: 'r2_eoVPtrNI.cwA.gzc.7ax_Wvx70lanile7IAq5P69Rl9vF6rylTd8v3r0iF2w',
            botUnknownResponse: "",
            watermark: 0,
            convId: "",
            streamUrl: "",
            botKeyWords: 'Quote'
        },
        {
            botName: 'Locator-bot-demo',
            botSecret: 'XEcazlI6LaE.cwA.4Po._hsH7QA1A-SaIT_-2LBVCxG3HKYNWJ-B8EeYXJcIqnA',
            botUnknownResponse: "",
            watermark: 0,
            convId: "",
            streamUrl: "",
            botKeyWords: 'Place'
        },
        {
            botName: 'bot-qna-demo',
            botSecret: 'mfibrSyD9Rg.cwA.84g.5GNhdsXzIBD9OEjmjBFo76K2TFftBRH9qnqrvImGYIY',
            botUnknownResponse: "",
            watermark: 0,
            convId: "",
            streamUrl: "",
            botKeyWords: 'FAQ'
        }
    ];
    addBot(null, bots[0], botConfig);
    addBot(null, bots[1], botConfig);
    addBot(null, bots[2], botConfig);
}

// clear the current configuration
intents.matches(/^masterbot clearconfig/i, [
    function (session) {
        botConfig = [];
        saveConfig(session, botConfig);
        session.send("Configuration cleared!");
    }
]);

// show current configuration
intents.matches(/^masterbot showconfig/i, [
    function (session) {
        if (botConfig.length > 0) {
            session.send("Current Configuration:");
            for (var i = 0; i < botConfig.length; i++) {
                session.send("BN:" + botConfig[i].botName + "  BS:" + botConfig[i].botSecret +
                    "  BUR:" + botConfig[i].botUnknownResponse + "  WAT:" + botConfig[i].watermark +
                    "  CID:" + botConfig[i].convId);
            }
        } else {
            session.send("Current configuration is empty!");
        }
    }
]);

// set verbose flag
intents.matches(/^masterbot verbose/i, [
    function (session) {
        if (verboseOutput == true) verboseOutput = false
        else verboseOutput = true;

        session.send("Verbose flag set to: " + verboseOutput);
    }
]);

// add a new bot to our config
intents.matches(/^masterbot addbot/i, [
    // ask for the name of the bot
    function (session) {
        builder.Prompts.text(session, "Please enter the name of the bot to add (MUST match what bot sends):");
    },

    // enter in the secret for the bot, NOTE: Using simple model with secret, did not implement per user / conversation tokens
    function (session, results) {
        session.dialogData.botName = results.response;
        builder.Prompts.text(session, "Please enter the API secret for the bot:");
    },

    // add the bot to the configuration
    function (session, results) {
        session.dialogData.botSecret = results.response;

        // load the current config
        botConfig = loadConfig(session);

        // create a new element
        var configItem = {
            botName: session.dialogData.botName,
            botSecret: session.dialogData.botSecret,
            botUnknownResponse: "",
            watermark: 0,
            convId: "",
            streamUrl: ""
        };

        addBot(session, configItem, botConfig);
    }
]);

function addBot(session, configItem, botConfig) {
    botConfig.push(configItem);
    saveConfig(session, botConfig);

    sendMsg(session, "Bot added to configuration. Checking connectivity to bot...");
    initChat(session, botConfig.length - 1);
}

// remove a bot from our config
intents.matches(/^masterbot removebot/i, [
    // show the list of bots and ask which is to be removed
    function (session) {
        // show the current bots
        botConfig = loadConfig(session);
        if (botConfig.length > 0) {
            session.send("Currently configured bots:");
            var promptList = "";
            for (var i = 0; i < botConfig.length; i++) {
                promptList += botConfig[i].botName;
                if (i < botConfig.length - 1)
                    promptList += "|";
            }
            builder.Prompts.choice(session, "Please select the bot to be removed:", promptList);
        } else {
            session.send("No bots are configured!");
            next({
                response: null
            });
        }
    },
    // remove the selected bot
    function (session, results) {
        if (results.response) {
            for (var i = 0; i < botConfig.length; i++) {
                if (results.response.entity == botConfig[i].botName)
                    botConfig.splice(i, 1);
                saveConfig(session, botConfig);
                session.send("Removed '" + results.response.entity + "' from configuration.");
                break;
            }
        }
    }
]);

intents.matches(/^topics/i, [
    function (session) {
        currentBot = null;
        greeting(session);
    }
]);

intents.matches(/^hi/i, [
    function (session) {
        greeting(session);
    }
]);

intents.matches(/^hello/i, [
    function (session) {
        greeting(session);
    }
]);

// our default handler will pass the utterance to the child bots
intents.onDefault([
    function (session, args, next) {
        if (currentBot != null) {
            sendMessage(session, currentBot);
        } else {
            // see if we match a topic
            var words = session.message.text.split(" ");
            for (var i = 0; i < botConfig.length; i++) {
                for (var w = 0; w < words.length; w++) {
                    if (botConfig[i].botKeyWords.toLowerCase().search(words[w].toLowerCase()) > -1) {
                        currentBot = botConfig[i];
                    }
                }
            }

            if (currentBot == null) {
                session.send("I don't know anyone that can talk about that!");
            } else {
                session.send("Ok your are now talking to the " + currentBot.botName + " bot!");
                session.send("At anytime, just type in 'topics' to switch to a different topic and bot!");
            }
        }
    }
]);

function greeting(session) {
    if (currentBot != null) {
        sendMessage(session, currentBot);
        return;
    }

    session.send("Hello! I am the master bot.  I can help you talk with other bots on the following topics: ");
    for (var i = 0; i < botConfig.length; i++) {
        session.send(botConfig[i].botKeyWords);
    }
    session.send("Just ask about any of those topics and I can direct you to a bot that can answer questions.");
}

// send a message to all bots
function queryBots(session, responseHandler) {
    //botConfig = loadConfig(session);
    for (var i = 0; i < botConfig.length; i++) {
        sendMessage(session, i);
    }
}

//init chat
function initChat(session, configIndex) {
    fetch('https://directline.botframework.com/v3/directline/conversations', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + botConfig[configIndex].botSecret
            }
        }).then((response) => response.json())
        .then((responseJson) => {
            sendMsg(session, "Connection successful: " + responseJson.conversationId);
            botConfig[configIndex].convId = responseJson.conversationId;
            botConfig[configIndex].streamUrl = responseJson.streamUrl;
            saveConfig(session, botConfig);

            // enable websockets interface
            enableWebSockets(session, configIndex, function () {

                // determine the bots unknown response by sending it some junk data
                //sendMsg(session, "Determing unknown response...");
                //determineUnknown(session, configIndex);
            });
        });
}

function enableWebSockets(session, configIndex, callback) {
    console.log('Starting WebSocket Client for message streaming on conversationId: ' + botConfig[configIndex].convId);

    var ws = new websocket.client();

    ws.on('connectFailed', function (error) {
        console.log('Connect Error: ' + error.toString());
    });

    ws.on('connect', function (connection) {
        console.log('WebSocket Client Connected');

        connection.on('error', function (error) {
            console.log("Connection Error: " + error.toString());
        });

        connection.on('close', function () {
            console.log('WebSocket Client Disconnected');
        });

        connection.on('message', function (message) {
            if (message.type === 'utf8' && message.utf8Data.length > 0) {
                //console.log(message.utf8Data);
                var data = JSON.parse(message.utf8Data);
                //watermark = data.watermark;

                if (data.activities[0].from.id != "MastBot") {
                    if (verboseOutput == true) {
                        sendMsg(session, data.activities);
                        //console.log(data.activities);
                    } else {
                        sendMsg(session, data.activities[0]);
                        //console.log(data.activities[0].text);
                    }
                }
                // first reply should be our unknown response
                /*if (botConfig[configIndex].botUnknownResponse === "" &&
                    data.activities[0].from.id !== "MastBot") {
                    botConfig[configIndex].botUnknownResponse = data.activities[0].text;
                    console.log("Got unknown reply: " + botConfig[configIndex].botUnknownResponse);
                }*/
            }
        });

        callback();
    });

    ws.connect(botConfig[configIndex].streamUrl);

    socketList[configIndex] = ws;
}

// determing the unknown response
function determineUnknown(session, configIndex) {
    fetch('https://directline.botframework.com/v3/directline/conversations/' + botConfig[configIndex].convId + '/activities', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + botConfig[configIndex].botSecret,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'type': "message",
                'text': "!@#$ADLFJADFL!#$!#!@#",
                'from': {
                    "id": 'MastBot'
                }
            })
        }).then((response) => response.json())
        .then((responseJson) => {
            sendMsg(session, "Sent unknown reply query...");
        });
}

// send message
function sendMessage(session, bot) {
    //console.log("Sending: " + session.message.text);
    fetch('https://directline.botframework.com/v3/directline/conversations/' + bot.convId + '/activities', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + bot.botSecret,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'text': session.message.text,
                'from': {
                    "id": 'MastBot'
                },
                "type": "message"
            })
        }).then((response) => response.json())
        .then((responseJson) => {
            //session.send("Message sent");
        });
}

// load the current config.  initialize to an empty array if no current config
function loadConfig(session) {
    var savedConfig = session.userData.botConfig;
    if (typeof savedConfig == "undefined") {
        botConfig = [];

        savedConfig = botConfig;
    }
    return savedConfig;
}

// save a new configuration
function saveConfig(session, botConfig) {
    if (session != null)
        session.userData.botConfig = botConfig;
}

// send a message if we have a valid session, otherwise console
function sendMsg(session, msg) {
    var text = msg;
    if (typeof msg.text != "undefined")
        text = msg.text;

    if (session != null)
        session.send(text);
    else
        console.log("LOCALMSG: " + text);
}

if (useEmulator) {
    var restify = require('restify');
    var server = restify.createServer();
    server.listen(3978, function () {
        console.log('test bot endpont at http://localhost:3978/api/messages');
    });
    server.post('/api/messages', connector.listen());
} else {
    if (useConsole == false)
        module.exports = {
            default: connector.listen()
        }
}