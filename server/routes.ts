import * as path from 'path'
import { credentialRequirements, serviceUrl } from '../config'
import { Express } from 'express'
import { validateCredentialSignatures, extractDataFromClaims, randomString } from '../src/utils/'
import { RedisApi } from './types'
import { JSONWebToken } from 'jolocom-lib/js/interactionFlows/JSONWebToken'
import { CredentialRequest } from 'jolocom-lib/js/interactionFlows/credentialRequest/credentialRequest'
import { InteractionType } from 'jolocom-lib/js/interactionFlows/types'
import { IdentityWallet } from 'jolocom-lib/js/identityWallet/identityWallet'
import { claimsMetadata } from 'cred-types-jolocom-demo'
import { Identity } from 'jolocom-lib/js/identity/identity'
import { JolocomLib } from 'jolocom-lib'

export const configureRoutes = async (app: Express, redisApi: RedisApi, iw: IdentityWallet) => {
  const { setAsync } = redisApi

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'))
  })

  app.get('/assets/:name', (req, res) => {
    const { name } = req.params
    res.sendFile(path.join(__dirname, `../dist/img/${name}`))
  })

  app.get('/authentication/credentialRequest', async (req, res) => {
    const userId = randomString(5)
    const callbackURL = `${serviceUrl}/authentication/${userId}`

    const credentialRequest = await iw.create
      .credentialRequestJSONWebToken({
        typ: InteractionType.CredentialRequest,
        credentialRequest: {
          callbackURL,
          credentialRequirements
        }
      })
      .encode()

    res.json({ token: credentialRequest })
  })

  app.post('/receive', async (req, res) => {
    const { token } = req.body

    // Validates the signature on the JWT
    const credentialOfferReq = await JolocomLib.parse.interactionJSONWebToken.decode(token)

    const tinkererToken = await iw.create.signedCredential({
      metadata: {
        type: ['Credential', 'ProofOfTinkererCredential'],
        name: 'Tinkerer',
        context: [
          {
            ProofOfTinkererCredential: 'https://identity.jolocom.com/terms/ProofOfTinkererCredential'
          }
        ]
      },
      claim: {
        note: 'Thank you for attending our session at Web3!'
      },
      subject: credentialOfferReq.iss.substring(0, credentialOfferReq.iss.indexOf('#'))
    })

    const encodedCredential = await iw.create
      .credentialsReceiveJSONWebToken({
        iss: iw.getIdentity().getDID(),
        typ: InteractionType.CredentialsReceive,
        credentialsReceive: {
          signedCredentials: [tinkererToken.toJSON()]
        }
      })
      .encode()

    res.json({ token: encodedCredential })
  })

  app.post('/receiveCredential', async (req, res) => {
    const userId = randomString(5)
    const callbackURL = `${serviceUrl}/authentication/${userId}`

    const credentialRequest = await iw.create
      .credentialRequestJSONWebToken({
        typ: InteractionType.CredentialRequest,
        credentialRequest: {
          callbackURL,
          credentialRequirements
        }
      })
      .encode()

    res.json({ token: credentialRequest })
  })

  app.post('/authentication/:clientId', async (req, res, next) => {
    const { clientId } = req.params
    const { token } = req.body

    try {
      const { credentialResponse, iss } = await JSONWebToken.decode(token)
      await validateCredentialSignatures(credentialResponse)

      const credentialRequest = CredentialRequest.create({
        callbackURL: '',
        credentialRequirements
      })

      if (!credentialResponse.satisfiesRequest(credentialRequest)) {
        throw new Error('The supplied credentials do not match the types of the requested credentials')
      }

      // KeyId -> Issuer DID conversion should be abstracted.
      const userData = {
        ...extractDataFromClaims(credentialResponse),
        did: iss.substring(0, iss.indexOf('#')),
        status: 'success'
      }

      await setAsync(clientId, JSON.stringify({ status: 'success', data: userData }))

      res.json('OK')
    } catch (err) {
      next(err)
    }
  })
}
