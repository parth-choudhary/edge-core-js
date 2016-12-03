import bip39 from 'bip39'

import * as crypto from '../crypto.js'
import {Login} from './login.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (ctx, username) {
  username = userMap.normalize(username)

  const userId = userMap.getUserId(ctx.localStorage, username)
  const request = {
    'l1': userId
  }
  return ctx.authRequest('POST', '/v1/account/available', request)
}

/**
 * Creates a new login on the auth server.
 */
export function create (ctx, username, password, opts) {
  username = userMap.normalize(username)
  const userId = userMap.getUserId(ctx.localStorage, username)

  // Create random key material:
  const passwordKeySnrp = crypto.makeSnrp()
  const dataKey = crypto.random(32)
  const syncKey = opts.syncKey || crypto.random(20)

  // Derive keys from password:
  const passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)
  const passwordKey = crypto.scrypt(username + password, passwordKeySnrp)

  // Encrypt:
  const passwordBox = crypto.encrypt(dataKey, passwordKey)
  const passwordAuthBox = crypto.encrypt(passwordAuth, dataKey)
  const syncKeyBox = crypto.encrypt(syncKey, dataKey)

  // Package:
  const carePackage = {
    'SNRP2': passwordKeySnrp
  }
  const loginPackage = {
    'EMK_LP2': passwordBox,
    'ESyncKey': syncKeyBox,
    'ELP1': passwordAuthBox
  }
  const request = {
    'l1': userId,
    'lp1': passwordAuth.toString('base64'),
    'care_package': JSON.stringify(carePackage),
    'login_package': JSON.stringify(loginPackage),
    'repo_account_key': syncKey.toString('hex')
  }

  return ctx.authRequest('POST', '/v1/account/create', request).then(reply => {
    // Cache everything for future logins:
    userMap.insert(ctx.localStorage, username, userId)
    const userStorage = new UserStorage(ctx.localStorage, username)
    userStorage.setJson('passwordKeySnrp', passwordKeySnrp)
    userStorage.setJson('passwordBox', passwordBox)
    userStorage.setJson('passwordAuthBox', passwordAuthBox)
    userStorage.setJson('syncKeyBox', syncKeyBox)

    // Now upgrade:
    return upgrade(ctx, userStorage, userId, passwordAuth, dataKey).then(() => {
      // Now activate:
      const request = {
        'l1': userId,
        'lp1': passwordAuth.toString('base64')
      }
      return ctx.authRequest('POST', '/v1/account/activate', request).then(reply => {
        return Login.offline(ctx.localStorage, username, dataKey)
      })
    })
  })
}

export function upgrade (ctx, userStorage, userId, passwordAuth, dataKey) {
  // Create a BIP39 mnemonic, and use it to derive the rootKey:
  const entropy = crypto.random(256 / 8)
  const mnemonic = bip39.entropyToMnemonic(entropy.toString('hex'))
  const rootKey = bip39.mnemonicToSeed(mnemonic)
  const infoKey = crypto.hmacSha256(rootKey, 'infoKey')

  // Pack the keys into various boxes:
  const rootKeyBox = crypto.encrypt(rootKey, dataKey)
  const mnemonicBox = crypto.encrypt(new Buffer(mnemonic, 'utf-8'), infoKey)
  const dataKeyBox = crypto.encrypt(dataKey, infoKey)

  const request = {
    'l1': userId,
    'lp1': passwordAuth.toString('base64'),
    'rootKeyBox': rootKeyBox,
    'mnemonicBox': mnemonicBox,
    'syncDataKeyBox': dataKeyBox
  }
  return ctx.authRequest('POST', '/v1/account/upgrade', request).then(reply => {
    userStorage.setJson('rootKeyBox', rootKeyBox)
    return null
  })
}
