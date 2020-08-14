/*
 * Starboard discord bot written in nodejs: react to posts and have it post to a pin
 * channel after a configurable threshhold. originally meant for moonmoon_ow discord server.
 * Developed by Rushnett and Keiaxx.
 */

// discord init
const Discord = require('discord.js')
const client = new Discord.Client({
  partials: Object.values(Discord.Constants.PartialTypes)
})

// emoji that goes in the post title
const tt = '⭐'
let guildID = ''
let starboardID = ''
let messagePosted = {}
let loading = true

// login to discord
function login () {
  if (process.env.BOT_TOKEN) {
    console.log('Logging in with token...')
    client.login(process.env.BOT_TOKEN)
  } else {
    console.log('Error logging in: There may be an issue with you BOT_TOKEN variable')
  }
}


async function * messagesIterator (channel, messagesLeft) {
  let before = null
  let done = false
  while (messagesLeft > 0) {
    process.stdout.write(".")
    const messages = await channel.messages.fetch({ limit: 100, before })
    if (messages.size > 0) {
      before = messages.lastKey()
      messagesLeft = messagesLeft - 100
      yield messages
    } else break
  }
}

async function * loadMessages (channel, amount) {
  for await (const messages of messagesIterator(channel, amount)) {
    for (const message of messages.values()) yield message
  }
}

// load old messages into memory
async function loadIntoMemory () {
  const channel = client.guilds.cache.get(guildID).channels.cache.get(starboardID)
  let amount = process.env.fetchLimit
  console.log(`Fetching the last ${amount} messages...`)

  // iterate through all messages as they're pulled
  for await (const message of loadMessages(channel, amount)) {
    // verify footer exists and grab original message ID
    if (message.embeds.length > 0 && message.embeds[0].footer) {
      const footerID = String(message.embeds[0].footer.text).match(/\((\d{18})\)/)
      if (footerID) {
        // save post to memory
        messagePosted[footerID[1]] = {
          p: true, // is posted
          lc: process.env.threshold + 1, // reaction amount
          legacy: false, // is legacy
          psm: message.id // starboard msg id
        }
      }
    }
  }
  loading = false
  console.log(`\nLoaded ${Object.keys(messagePosted).length} previous posts in ${process.env.reactionEmoji} channel!`)
}

// manage the message board on reaction add/remove
function manageBoard (reaction_orig) {

  const msg = reaction_orig.message
  const msgChannel = client.guilds.cache.get(guildID).channels.cache.get(msg.channel.id)
  const msgLink = `https://discordapp.com/channels/${guildID}/${msg.channel.id}/${msg.id}`
  const postChannel = client.guilds.cache.get(guildID).channels.cache.get(starboardID)

  msgChannel.messages.fetch(msg.id).then((msg) => {
    // if message is older than set amount
    const dateDiff = (new Date()) - reaction_orig.message.createdAt
    const dateCutoff = 1000 * 60 * 60 * 24
    if (Math.floor(dateDiff / dateCutoff) >= process.env.dateCutoff) {
      console.log(`a message older than ${process.env.dateCutoff} days was reacted to, ignoring`)
      return
    }

    // we need to do this because the reaction count seems to be 1 if an old cached
    // message is starred. This is to get the 'actual' count
    msg.reactions.cache.forEach((reaction) => {
      if (reaction.emoji.name == process.env.reactionEmoji) {
        console.log(`message ${process.env.reactionEmoji}'d! (${msg.id}) in #${msgChannel.name} total: ${reaction.count}`)
        // did message reach threshold
        if (reaction.count >= process.env.threshold) {
          messagePosted[msg.id].lc = reaction.count
          // if message is already posted
          if (messagePosted[msg.id].hasOwnProperty('psm')) {
            const editableMessageID = messagePosted[msg.id].psm
            console.log(`updating count of message with ID ${editableMessageID}. reaction count: ${reaction.count}`)
            const messageFooter = `${reaction.count} ${tt} (${msg.id})`
            postChannel.messages.fetch(editableMessageID).then((message) => {
              message.embeds[0].setFooter(messageFooter)
              message.edit(message.embeds[0])
            })
          } else {
            // if message has already been created
            if (messagePosted[msg.id].p) return

            console.log(`posting message with content ID ${msg.id}. reaction count: ${reaction.count}`)
            // add message to ongoing object in memory
            messagePosted[msg.id].p = true

            // create content message
            const contentMsg = `${msg.content}\n\n→ [original message](${msgLink}) in <#${msg.channel.id}>`
            const avatarURL = `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.jpg`
            const embeds = msg.embeds
            const attachments = msg.attachments
            const messageFooter = `${reaction.count} ${tt} (${msg.id})`
            let eURL = ''

            if (embeds.length > 0) {
              // attempt to resolve image url; if none exist, ignore it
              if (embeds[0].thumbnail && embeds[0].thumbnail.url) { eURL = embeds[0].thumbnail.url } else if (embeds[0].image && embeds[0].image.url) { eURL = embeds[0].image.url } else { eURL = embeds[0].url }
            } else if (attachments.array().length > 0) {
              const attARR = attachments.array()
              eURL = attARR[0].url
              // no attachments or embeds
            }

            const embed = new Discord.MessageEmbed()
              .setAuthor(msg.author.username, avatarURL)
              .setColor(process.env.hexcolor)
              .setDescription(contentMsg)
              .setImage(eURL)
              .setTimestamp(new Date())
              .setFooter(messageFooter)
            postChannel.send({
              embed
            }).then((starMessage) => {
              messagePosted[msg.id].psm = starMessage.id
            })
          }
        }
      }
    })
  })
}

// delete a post
function deletePost (msg) {
  const postChannel = client.guilds.cache.get(guildID).channels.cache.get(starboardID)
  // if posted to channel board before
  if (messagePosted[msg.id].p) {
    const editableMessageID = messagePosted[msg.id].psm
    postChannel.messages.fetch(editableMessageID).then((message) => {
      delete messagePosted[msg.id]
      message.delete()
        .then(msg => console.log(`Removed message with ID ${editableMessageID}. Reaction count reached 0.`))
        .catch(console.error)
    })
  }
}

// ON READY
client.on('ready', () => {
  console.log(`Logged in as ${client.user.username}!`)
  guildID = process.env.serverID
  starboardID = process.env.channelID
  // fetch existing posts
  loadIntoMemory()
})

// ON REACTION ADD
client.on('messageReactionAdd', (reaction_orig, user) => {
  if (loading) return
  // if channel is posting channel
  if (reaction_orig.message.channel.id == starboardID) return
  // if reaction is not desired emoji
  if (reaction_orig.emoji.name !== process.env.reactionEmoji) return

  const msg = reaction_orig.message

  // if message doesnt exist yet in memory, create it
  if (!messagePosted.hasOwnProperty(msg.id)) {
    // p: boolean: has been posted to channel,
    // lc: int: number of stars
    messagePosted[msg.id] = {
      p: false,
      lc: 0
    }
  } else {
    if (messagePosted[msg.id].legacy) {
      console.log(`Legacy message ${process.env.reactionEmoji}'d, ignoring`)
      return
    }
  }

  manageBoard(reaction_orig)
})

// ON REACTION REMOVE
client.on('messageReactionRemove', (reaction, user) => {
  if (loading) return
  // if channel is posting channel
  if (reaction.message.channel.id == starboardID) return
  // if reaction is not desired emoji
  if (reaction.emoji.name !== process.env.reactionEmoji) return


  // if reactions reach 0
  if (reaction.count === 0)
    return deletePost(reaction.message)
  else
    manageBoard(reaction)
})

// ON REACTION PURGE
client.on('messageReactionRemoveAll', (msg) => {
  deletePost(msg)
})


client.on('message', async message => { 
  let prefix = "!"
  if (!message.content.startsWith(prefix)) return;
  let args = message.content.slice(prefix.length).trim().split(/ +/g);
  let msg = message.content.toLowerCase();
  let cmd = args.shift().toLowerCase();
  
  if (msg.startsWith(prefix + 'starboard')) {
    message.channel.send(`\nLoaded ${Object.keys(messagePosted).length} previous posts in ${process.env.reactionEmoji} channel!`); // results.
  }
})

login()