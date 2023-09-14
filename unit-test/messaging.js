import {
    Messaging,
    MessagingContext,
    TestTransportConfig,
    RequestMessage, NotificationMessage, Subscription, MessageResponse
} from '@duckduckgo/messaging'
import { AndroidMessagingConfig } from '@duckduckgo/messaging/lib/android.js'

describe('Messaging Transports', () => {
    it('calls transport with a RequestMessage', () => {
        const { messaging, transport } = createMessaging()

        const spy = spyOn(transport, 'request')

        messaging.request('helloWorld', { foo: 'bar' })

        expect(spy).toHaveBeenCalledWith(new RequestMessage({
            context: 'contentScopeScripts',
            featureName: 'hello-world',
            id: 'helloWorld.response',
            method: 'helloWorld',
            params: { foo: 'bar' }
        }))
    })
    it('calls transport with a NotificationMessage', () => {
        const { messaging, transport } = createMessaging()

        const spy = spyOn(transport, 'notify')

        messaging.notify('helloWorld', { foo: 'bar' })

        expect(spy).toHaveBeenCalledWith(new NotificationMessage({
            context: 'contentScopeScripts',
            featureName: 'hello-world',
            method: 'helloWorld',
            params: { foo: 'bar' }
        }))
    })
    it('calls transport with a Subscription', () => {
        const { messaging, transport } = createMessaging()

        const spy = spyOn(transport, 'subscribe')
        const callback = jasmine.createSpy()

        messaging.subscribe('helloWorld', callback)

        expect(spy).toHaveBeenCalledWith(new Subscription({
            context: 'contentScopeScripts',
            featureName: 'hello-world',
            subscriptionName: 'helloWorld'
        }), callback)
    })
})

describe('Android', () => {
    /**
     * @param {Record<string, any>} target
     * @return {AndroidMessagingConfig}
     */
    function createConfig (target) {
        const config = new AndroidMessagingConfig({
            target,
            method: 'ContentScopeScripts',
            secret: 'abc',
            messageCallback: 'callback_abc_def'
        })
        return config
    }
    /**
     * @param {string} featureName
     * @param {AndroidMessagingConfig} config
     */
    function createContext (featureName, config) {
        const messageContextA = new MessagingContext({
            context: config.method,
            featureName,
            env: 'development'
        })
        const messaging = new Messaging(messageContextA, config)
        return { messaging }
    }
    it('sends notification to 1 feature', () => {
        const spy = jasmine.createSpy()
        const target = {
            ContentScopeScripts: {
                process: spy
            }
        }
        const config = createConfig(target)
        const { messaging } = createContext('featureA', config)
        messaging.notify('helloWorld')
        const payload = '{"context":"ContentScopeScripts","featureName":"featureA","method":"helloWorld","params":{}}'
        const secret = 'abc'
        expect(spy).toHaveBeenCalledWith(payload, secret)
    })
    it('sends notification to 2 separate features', () => {
        const spy = jasmine.createSpy()
        const target = {
            ContentScopeScripts: {
                process: spy
            }
        }
        const config = createConfig(target)
        const { messaging } = createContext('featureA', config)
        const { messaging: bMessaging } = createContext('featureB', config)
        messaging.notify('helloWorld')
        bMessaging.notify('helloWorld')
        const expected1 = '{"context":"ContentScopeScripts","featureName":"featureA","method":"helloWorld","params":{}}'
        const expected2 = '{"context":"ContentScopeScripts","featureName":"featureA","method":"helloWorld","params":{}}'
        expect(spy).toHaveBeenCalledTimes(2)
        expect(spy).toHaveBeenCalledWith(expected1, 'abc')
        expect(spy).toHaveBeenCalledWith(expected2, 'abc')
    })
    it('sends request and gets response', async () => {
        const spy = jasmine.createSpy()
        /** @type {MessageResponse} */
        let msg
        /** @type {string} */
        let token
        const target = {
            ContentScopeScripts: {
                process: (outgoing, _token) => {
                    msg = JSON.parse(outgoing)
                    token = _token
                    spy(outgoing, _token)
                }
            }
        }
        const config = createConfig(target)
        const { messaging } = createContext('featureA', config)
        const request = messaging.request('helloWorld')
        // @ts-ignore
        if (!msg) throw new Error('must have set msg by this point in the test')

        // simulate a valid response
        const response = new MessageResponse({
            id: msg.id,
            context: msg.context,
            featureName: msg.featureName,
            result: { foo: 'bar' }
        })

        // pretend to call back from native
        target[config.messageCallback](config.secret, JSON.stringify(response))

        // wait for it to resolve
        const result = await request

        // ensure the outgoing payload was correct
        const expectedOutgoing = '{"context":"ContentScopeScripts","featureName":"featureA","method":"helloWorld","id":"helloWorld.response","params":{}}'
        expect(spy).toHaveBeenCalledWith(expectedOutgoing, 'abc')

        // ensure the result is correct
        expect(result).toEqual({ foo: 'bar' })

        // @ts-ignore
        expect(token).toEqual(config.secret)
    })
})

/**
 * Creates a test transport and Messaging instance for testing
 */
function createMessaging () {
    /** @type {import("@duckduckgo/messaging").MessagingTransport} */
    const transport = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        notify (msg) {
            // test
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        request: (_msg) => {
            // test
            return Promise.resolve(null)
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        subscribe (_msg) {
            // test
            return () => {
                // test teardown
            }
        }
    }

    const testTransportConfig = new TestTransportConfig(transport)

    const messagingContext = new MessagingContext({
        context: 'contentScopeScripts',
        featureName: 'hello-world',
        env: 'development'
    })

    const messaging = new Messaging(messagingContext, testTransportConfig)

    return { transport, messaging }
}
