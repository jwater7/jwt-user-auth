// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

var jwt = require('jsonwebtoken');
const { JsonDB, Config } = require('node-json-db');
const crypto = require("crypto");

class jwtUserAuth {

  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    // Save after each push = true, save in human readable format = true
    this.db = new JsonDB(new Config(this.dbPath + '/config.json', true, true));

    // Check DB Version
    try {
      let ver = await this.db.getData('/dbVersion');
      if (ver !== '0') {
        throw (new Error('version mismatch'))
      }
    } catch (e) {
      //this.db.delete('/');
      // Initialize Database
      await this.db.push('/dbVersion', '0');
      // TODO need to hash to keep safe
      let password = process.env.DEFAULT_PASSWORD || crypto.randomBytes(3 * 4).toString('base64');
      await this.db.push('/users', {
        'admin': {
          password,
          'hashed': false,
          'roles': ['admin'],
        }
      });
      let privateKey = process.env.DEFAULT_PRIVATE_KEY || crypto.randomBytes(3 * 4).toString('base64');
      // TODO need to keep safe
      await this.db.push('/privateKey', privateKey);
    }

    this.privateKey = crypto.randomBytes(3 * 4).toString('base64');
    // If we passed in the private key then use it instead
    if (process.env.PRIVATE_KEY) {
      this.privateKey = process.env.PRIVATE_KEY;
    }
    // Override any generated or passed in keys if there's one in the DB
    try {
      const dbPrivateKey = await this.db.getData('/privateKey');
      // if no exception so far then we use it here
      this.privateKey = dbPrivateKey;
    } catch (e) { }

    this.users = [];
    try { this.users = await this.db.getData('/users'); } catch (e) { }

    this.keyBlackList = {};

    // retain "this"
    this.checkBlackList = this.checkBlackList.bind(this);
  }

  addToBlackList(token, expiretime) {
    this.keyBlackList[token] = {
      'expiretime': expiretime,
    };
  }

  checkBlackList(token) {
    // Auto clean the list
    for (var key in this.keyBlackList) {
      if ('expiretime' in this.keyBlackList[key]) {
        // Delete if its expired anyway
        if (this.keyBlackList[key].expiretime <= Math.round(Date.now() / 1000)) {
          delete this.keyBlackList[key];
        }
      }
    }
    // If in the blacklist return bad
    if (this.keyBlackList[token]) {
      return false;
    }
    return true;
  }

  logout(token) {
    if (token) {
      jwt.verify(token, this.privateKey, function (err, decoded) {
        if (!err) {
          this.addToBlackList(token, decoded.exp);
        }
      }.bind(this));
    }
  }

  login(username, password, options) {
    if (this.users[username] && this.users[username].password == password) {
      //console.log("login: " + username);
      return jwt.sign({
        'user': username,
        'roles': this.users[username].roles,
      }, this.privateKey, {
        expiresIn: 60 * 60 * 24, // default expires in 24 hours
        ...options,
      });
    }
    return false;
  }

  authenticate(req, res, next) {
    var token = req.body.token || req.query.token || req.headers['x-api-key'];
    if (token) {
      jwt.verify(token, this.privateKey, function (err, decoded) {
        if (!err) {
          if (this.checkBlackList(token)) {
            req.decoded = decoded;
          }
        }
      }.bind(this));
    }
    next();
  }

  required(req, res, next) {
    if (req.decoded) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: 403,
        message: 'Not Authenticated',
      }
    });
    res.end();
  }

}

module.exports = jwtUserAuth;

