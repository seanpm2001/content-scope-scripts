/**
 * @description
 *
 * A wrapper for messaging on Android.
 *
 * You must share a {@link AndroidMessagingConfig} instance between features
 *
 * @example
 *
 * ```javascript
 * [[include:packages/messaging/lib/examples/windows.example.js]]```
 *
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { MessagingTransport, MessageResponse, SubscriptionEvent } from '../index.js'
import { isResponseFor, isSubscriptionEventFor } from '../schema.js'

/**
 * An implementation of {@link MessagingTransport} for Android
 *
 * All messages go through `window.chrome.webview` APIs
 *
 * @implements {MessagingTransport}
 */
export class AndroidMessagingTransport {
    /**
     * @param {AndroidMessagingConfig} config
     * @param {import('../index.js').MessagingContext} messagingContext
     * @internal
     */
    constructor (config, messagingContext) {
        this.messagingContext = messagingContext
        this.config = config
    }

    /**
     * @param {import('../index.js').NotificationMessage} msg
     */
    notify (msg) {
        this.config.sendMessage?.(JSON.stringify(msg), this.config.secret)
    }

    /**
     * @param {import('../index.js').RequestMessage} msg
     * @param {{signal?: AbortSignal}} opts
     * @return {Promise<any>}
     */
    request (msg, opts = {}) {
        const prom = new Promise((resolve, reject) => {
            const unsub = this.config.subscribe(msg.id, handler)
            function handler (data) {
                console.log('--', { data })
                if (isResponseFor(msg, data)) {
                    if (data.result) {
                        resolve(data.result || {})
                        return unsub()
                    } else {
                        // forward the error if one was given explicitly
                        if (data.error) {
                            reject(new Error(data.error.message))
                            return unsub()
                        }
                    }
                    unsub()
                    throw new Error('unreachable: must have `result` or `error` key')
                }
            }
        })
        this.config.sendMessage?.(JSON.stringify(msg), this.config.secret)
        return prom
    }

    /**
     * @param {import('../index.js').Subscription} msg
     * @param {(value: unknown | undefined) => void} callback
     */
    subscribe (msg, callback) {
        const unsub = this.config.subscribe(msg.subscriptionName, (data) => {
            if (isSubscriptionEventFor(msg, data)) {
                callback(data.params || {})
            }
        })
        return () => {
            unsub()
        }
    }
}

/**
 * Android shared messaging configuration. A lot of logic
 * for sending/receiving messages is here to enable re-use of the single
 * global handler
 *
 * ```ts
 * [[include:packages/messaging/lib/examples/android.example.js]]```
 *
 */
export class AndroidMessagingConfig {
    /** @type {(json: string, secret: string) => void} */
    sendMessage

    /**
     * @type {Map<string, (msg: MessageResponse | SubscriptionEvent) => void>}
     */
    listeners = new globalThis.Map()
    /**
     * @param {object} params
     * @param {Record<string, any>} params.target
     * @param {string} params.secret
     * @param {string} params.method
     * @param {string} params.messageCallback
     */
    constructor (params) {
        const { target, method, secret, messageCallback } = params
        this.target = target
        this.method = method
        this.secret = secret
        this.messageCallback = messageCallback

        if (Object.prototype.hasOwnProperty.call(target, method)) {
            this.sendMessage = target[method].process.bind(target[method])
            delete target[method]
        } else {
            this.sendMessage = () => { console.error('Android messaging interface not available') }
        }

        /**
         * @type {(secret: string, response: string) => void}
         */
        const responseHandler = (providedSecret, response) => {
            if (providedSecret === secret) {
                this._dispatch(response)
            }
        }

        Object.defineProperty(target, messageCallback, {
            value: responseHandler
        })
    }

    /**
     * @param {string} id
     * @param {(msg: MessageResponse | SubscriptionEvent) => void} callback
     * @returns {() => void}
     */
    subscribe (id, callback) {
        this.listeners.set(id, callback)
        return () => {
            this.listeners.delete(id)
        }
    }

    /**
     * @param {string} response
     */
    _dispatch (response) {
        if (!response) throw new Error('missing response')
        const parsed = tryCatch(() => JSON.parse(response), 'parsing messages from android')

        if ('id' in parsed) {
            if (this.listeners.has(parsed.id)) {
                tryCatch(() => this.listeners.get(parsed.id)?.(parsed))
            } else {
                console.log('no listeners for ', parsed)
            }
        }

        if ('subscriptionName' in parsed) {
            if (this.listeners.has(parsed.subscriptionName)) {
                tryCatch(() => this.listeners.get(parsed.subscriptionName)?.(parsed))
            } else {
                console.log('no subscription listeners for ', response)
            }
        }
    }
}

/**
 *
 * @param {(...args: any[]) => any} fn
 * @param {string} [context]
 */
function tryCatch (fn, context = 'none') {
    try {
        return fn()
    } catch (e) {
        console.error('error occured in context: ', context, e)
    }
}
