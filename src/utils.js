/* global cloneInto, exportFunction, mozProxies */

// Only use globalThis for testing this breaks window.wrappedJSObject code in Firefox
// eslint-disable-next-line no-global-assign
let globalObj = typeof window === 'undefined' ? globalThis : window
let Error = globalObj.Error
let messageSecret

// save a reference to original CustomEvent amd dispatchEvent so they can't be overriden to forge messages
export const OriginalCustomEvent = typeof CustomEvent === 'undefined' ? null : CustomEvent
export const originalWindowDispatchEvent = typeof window === 'undefined' ? null : window.dispatchEvent.bind(window)
export function registerMessageSecret (secret) {
    messageSecret = secret
}

/**
 * @returns {HTMLElement} the element to inject the script into
 */
export function getInjectionElement () {
    return document.head || document.documentElement
}

/**
 * Creates a script element with the given code to avoid Firefox CSP restrictions.
 * @param {string} css
 * @returns {HTMLLinkElement}
 */
export function createStyleElement (css) {
    const style = document.createElement('link')
    style.href = 'data:text/css,' + encodeURIComponent(css)
    style.setAttribute('rel', 'stylesheet')
    style.setAttribute('type', 'text/css')
    return style
}

/**
 * Injects a script into the page, avoiding CSP restrictions if possible.
 */
export function injectGlobalStyles (css) {
    const style = createStyleElement(css)
    getInjectionElement().appendChild(style)
}

/**
 * Used for testing to override the globals used within this file.
 * @param {window} globalObjIn
 */
export function setGlobal (globalObjIn) {
    globalObj = globalObjIn
    Error = globalObj.Error
}

// Tests don't define this variable so fallback to behave like chrome
const hasMozProxies = typeof mozProxies !== 'undefined' ? mozProxies : false

// linear feedback shift register to find a random approximation
export function nextRandom (v) {
    return Math.abs((v >> 1) | (((v << 62) ^ (v << 61)) & (~(~0 << 63) << 62)))
}

const exemptionLists = {}
export function shouldExemptUrl (type, url) {
    for (const regex of exemptionLists[type]) {
        if (regex.test(url)) {
            return true
        }
    }
    return false
}

let debug = false

export function initStringExemptionLists (args) {
    const { stringExemptionLists } = args
    debug = args.debug
    for (const type in stringExemptionLists) {
        exemptionLists[type] = []
        for (const stringExemption of stringExemptionLists[type]) {
            exemptionLists[type].push(new RegExp(stringExemption))
        }
    }
}

/**
 * Best guess effort if the document is being framed
 * @returns {boolean} if we infer the document is framed
 */
export function isBeingFramed () {
    if ('ancestorOrigins' in globalThis.location) {
        return globalThis.location.ancestorOrigins.length > 0
    }
    return globalThis.top !== globalThis.window
}

/**
 * Best guess effort if the document is third party
 * @returns {boolean} if we infer the document is third party
 */
export function isThirdParty () {
    if (!isBeingFramed()) {
        return false
    }
    return !matchHostname(globalThis.location.hostname, getTabHostname())
}

/**
 * Best guess effort of the tabs hostname; where possible always prefer the args.site.domain
 * @returns {string|null} inferred tab hostname
 */
export function getTabHostname () {
    let framingOrigin = null
    try {
        framingOrigin = globalThis.top.location.href
    } catch {
        framingOrigin = globalThis.document.referrer
    }

    // Not supported in Firefox
    if ('ancestorOrigins' in globalThis.location && globalThis.location.ancestorOrigins.length) {
        // ancestorOrigins is reverse order, with the last item being the top frame
        framingOrigin = globalThis.location.ancestorOrigins.item(globalThis.location.ancestorOrigins.length - 1)
    }

    try {
        framingOrigin = new URL(framingOrigin).hostname
    } catch {
        framingOrigin = null
    }
    return framingOrigin
}

/**
 * Returns true if hostname is a subset of exceptionDomain or an exact match.
 * @param {string} hostname
 * @param {string} exceptionDomain
 * @returns {boolean}
 */
export function matchHostname (hostname, exceptionDomain) {
    return hostname === exceptionDomain || hostname.endsWith(`.${exceptionDomain}`)
}

const lineTest = /(\()?(https?:[^)]+):[0-9]+:[0-9]+(\))?/
export function getStackTraceUrls (stack) {
    const urls = new Set()
    try {
        const errorLines = stack.split('\n')
        // Should cater for Chrome and Firefox stacks, we only care about https? resources.
        for (const line of errorLines) {
            const res = line.match(lineTest)
            if (res) {
                urls.add(new URL(res[2], location.href))
            }
        }
    } catch (e) {
        // Fall through
    }
    return urls
}

export function getStackTraceOrigins (stack) {
    const urls = getStackTraceUrls(stack)
    const origins = new Set()
    for (const url of urls) {
        origins.add(url.hostname)
    }
    return origins
}

// Checks the stack trace if there are known libraries that are broken.
export function shouldExemptMethod (type) {
    // Short circuit stack tracing if we don't have checks
    if (!(type in exemptionLists) || exemptionLists[type].length === 0) {
        return false
    }
    const stack = getStack()
    const errorFiles = getStackTraceUrls(stack)
    for (const path of errorFiles) {
        if (shouldExemptUrl(type, path.href)) {
            return true
        }
    }
    return false
}

// Iterate through the key, passing an item index and a byte to be modified
export function iterateDataKey (key, callback) {
    let item = key.charCodeAt(0)
    for (const i in key) {
        let byte = key.charCodeAt(i)
        for (let j = 8; j >= 0; j--) {
            const res = callback(item, byte)
            // Exit early if callback returns null
            if (res === null) {
                return
            }

            // find next item to perturb
            item = nextRandom(item)

            // Right shift as we use the least significant bit of it
            byte = byte >> 1
        }
    }
}

export function isFeatureBroken (args, feature) {
    return isWindowsSpecificFeature(feature)
        ? !args.site.enabledFeatures.includes(feature)
        : args.site.isBroken || args.site.allowlisted || !args.site.enabledFeatures.includes(feature)
}

/**
 * For each property defined on the object, update it with the target value.
 */
export function overrideProperty (name, prop) {
    // Don't update if existing value is undefined or null
    if (!(prop.origValue === undefined)) {
        /**
         * When re-defining properties, we bind the overwritten functions to null. This prevents
         * sites from using toString to see if the function has been overwritten
         * without this bind call, a site could run something like
         * `Object.getOwnPropertyDescriptor(Screen.prototype, "availTop").get.toString()` and see
         * the contents of the function. Appending .bind(null) to the function definition will
         * have the same toString call return the default [native code]
         */
        try {
            defineProperty(prop.object, name, {
                // eslint-disable-next-line no-extra-bind
                get: (() => prop.targetValue).bind(null)
            })
        } catch (e) {
        }
    }
    return prop.origValue
}

export function defineProperty (object, propertyName, descriptor) {
    if (hasMozProxies) {
        const usedObj = object.wrappedJSObject
        const UsedObjectInterface = globalObj.wrappedJSObject.Object
        const definedDescriptor = new UsedObjectInterface();
        ['configurable', 'enumerable', 'value', 'writable'].forEach((propertyName) => {
            if (propertyName in descriptor) {
                definedDescriptor[propertyName] = cloneInto(
                    descriptor[propertyName],
                    definedDescriptor,
                    { cloneFunctions: true })
            }
        });
        ['get', 'set'].forEach((methodName) => {
            if (methodName in descriptor) {
                exportFunction(descriptor[methodName], definedDescriptor, { defineAs: methodName })
            }
        })
        UsedObjectInterface.defineProperty(usedObj, propertyName, definedDescriptor)
    } else {
        Object.defineProperty(object, propertyName, descriptor)
    }
}

export function camelcase (dashCaseText) {
    return dashCaseText.replace(/-(.)/g, (match, letter) => {
        return letter.toUpperCase()
    })
}

// We use this method to detect M1 macs and set appropriate API values to prevent sites from detecting fingerprinting protections
function isAppleSilicon () {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')

    // Best guess if the device is an Apple Silicon
    // https://stackoverflow.com/a/65412357
    return gl.getSupportedExtensions().indexOf('WEBGL_compressed_texture_etc') !== -1
}

/**
 * Take configSeting which should be an array of possible values.
 * If a value contains a criteria that is a match for this environment then return that value.
 * Otherwise return the first value that doesn't have a criteria.
 *
 * @param {*[]} configSetting - Config setting which should contain a list of possible values
 * @returns {*|undefined} - The value from the list that best matches the criteria in the config
 */
function processAttrByCriteria (configSetting) {
    let bestOption
    for (const item of configSetting) {
        if (item.criteria) {
            if (item.criteria.arch === 'AppleSilicon' && isAppleSilicon()) {
                bestOption = item
                break
            }
        } else {
            bestOption = item
        }
    }

    return bestOption
}

const functionMap = {
    /** Useful for debugging APIs in the wild, shouldn't be used */
    debug: (...args) => {
        console.log('debugger', ...args)
        // eslint-disable-next-line no-debugger
        debugger
    }
}

/**
 * Handles the processing of a config setting.
 * @param {*} configSetting
 * @param {*} defaultValue
 * @returns
 */
export function processAttr (configSetting, defaultValue) {
    if (configSetting === undefined) {
        return defaultValue
    }

    const configSettingType = typeof configSetting
    switch (configSettingType) {
    case 'object':
        if (Array.isArray(configSetting)) {
            configSetting = processAttrByCriteria(configSetting)
            if (configSetting === undefined) {
                return defaultValue
            }
        }

        if (!configSetting.type) {
            return defaultValue
        }

        if (configSetting.type === 'function') {
            if (configSetting.functionName && functionMap[configSetting.functionName]) {
                return functionMap[configSetting.functionName]
            }
        }

        if (configSetting.type === 'undefined') {
            return undefined
        }

        return configSetting.value
    default:
        return defaultValue
    }
}

export function getStack () {
    return new Error().stack
}

/**
 * @template {object} P
 * @typedef {object} ProxyObject<P>
 * @property {(target?: object, thisArg?: P, args?: object) => void} apply
 */

/**
 * @template [P=object]
 */
export class DDGProxy {
    /**
     * @param {string} featureName
     * @param {P} objectScope
     * @param {string} property
     * @param {ProxyObject<P>} proxyObject
     */
    constructor (featureName, objectScope, property, proxyObject) {
        this.objectScope = objectScope
        this.property = property
        this.featureName = featureName
        this.camelFeatureName = camelcase(this.featureName)
        const outputHandler = (...args) => {
            const isExempt = shouldExemptMethod(this.camelFeatureName)
            if (debug) {
                postDebugMessage(this.camelFeatureName, {
                    action: isExempt ? 'ignore' : 'restrict',
                    kind: this.property,
                    documentUrl: document.location.href,
                    stack: getStack(),
                    args: JSON.stringify(args[2])
                })
            }
            // The normal return value
            if (isExempt) {
                return DDGReflect.apply(...args)
            }
            return proxyObject.apply(...args)
        }
        const getMethod = (target, prop, receiver) => {
            if (prop === 'toString') {
                const method = Reflect.get(target, prop, receiver).bind(target)
                Object.defineProperty(method, 'toString', {
                    value: String.toString.bind(String.toString),
                    enumerable: false
                })
                return method
            }
            return DDGReflect.get(target, prop, receiver)
        }
        if (hasMozProxies) {
            this._native = objectScope[property]
            const handler = new globalObj.wrappedJSObject.Object()
            handler.apply = exportFunction(outputHandler, globalObj)
            handler.get = exportFunction(getMethod, globalObj)
            // @ts-expect-error wrappedJSObject is not a property of objectScope
            this.internal = new globalObj.wrappedJSObject.Proxy(objectScope.wrappedJSObject[property], handler)
        } else {
            this._native = objectScope[property]
            const handler = {}
            handler.apply = outputHandler
            handler.get = getMethod
            this.internal = new globalObj.Proxy(objectScope[property], handler)
        }
    }

    // Actually apply the proxy to the native property
    overload () {
        if (hasMozProxies) {
            // @ts-expect-error wrappedJSObject is not a property of objectScope
            exportFunction(this.internal, this.objectScope, { defineAs: this.property })
        } else {
            this.objectScope[this.property] = this.internal
        }
    }
}

export function postDebugMessage (feature, message) {
    if (message.stack) {
        const scriptOrigins = [...getStackTraceOrigins(message.stack)]
        message.scriptOrigins = scriptOrigins
    }
    globalObj.postMessage({
        action: feature,
        message
    })
}

export let DDGReflect
export let DDGPromise

// Exports for usage where we have to cross the xray boundary: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
if (hasMozProxies) {
    DDGPromise = globalObj.wrappedJSObject.Promise
    DDGReflect = globalObj.wrappedJSObject.Reflect
} else {
    DDGPromise = globalObj.Promise
    DDGReflect = globalObj.Reflect
}

export function isUnprotectedDomain (topLevelHostname, featureList) {
    let unprotectedDomain = false
    const domainParts = topLevelHostname.split('.')

    // walk up the domain to see if it's unprotected
    while (domainParts.length > 1 && !unprotectedDomain) {
        const partialDomain = domainParts.join('.')

        unprotectedDomain = featureList.filter(domain => domain.domain === partialDomain).length > 0

        domainParts.shift()
    }

    return unprotectedDomain
}

/**
 * @typedef {object} Platform
 * @property {'ios' | 'macos' | 'extension' | 'android' | 'windows'} name
 * @property {string | number } [version]
 */

/**
 * @typedef {object} UserPreferences
 * @property {Platform} platform
 * @property {boolean} [debug]
 * @property {boolean} [globalPrivacyControl]
 * @property {number} [versionNumber] - Android version number only
 * @property {string} [versionString] - Non Android version string
 * @property {string} sessionKey
 */

/**
 * Expansion point to add platform specific versioning logic
 * @param {UserPreferences} preferences
 * @returns {string | number | undefined}
 */
function getPlatformVersion (preferences) {
    if (preferences.versionNumber) {
        return preferences.versionNumber
    }
    if (preferences.versionString) {
        return preferences.versionString
    }
    return undefined
}

export function parseVersionString (versionString) {
    const [major = 0, minor = 0, patch = 0] = versionString.split('.').map(Number)
    return {
        major,
        minor,
        patch
    }
}

/**
 * @param {string} minVersionString
 * @param {string} applicationVersionString
 * @returns {boolean}
 */
export function satisfiesMinVersion (minVersionString, applicationVersionString) {
    const { major: minMajor, minor: minMinor, patch: minPatch } = parseVersionString(minVersionString)
    const { major, minor, patch } = parseVersionString(applicationVersionString)

    return (major > minMajor ||
            (major >= minMajor && minor > minMinor) ||
            (major >= minMajor && minor >= minMinor && patch >= minPatch))
}

/**
 * @param {string | number | undefined} minSupportedVersion
 * @param {string | number | undefined} currentVersion
 * @returns {boolean}
 */
function isSupportedVersion (minSupportedVersion, currentVersion) {
    if (typeof currentVersion === 'string' && typeof minSupportedVersion === 'string') {
        if (satisfiesMinVersion(minSupportedVersion, currentVersion)) {
            return true
        }
    } else if (typeof currentVersion === 'number' && typeof minSupportedVersion === 'number') {
        if (minSupportedVersion <= currentVersion) {
            return true
        }
    }
    return false
}

/**
 * @param {{ features: Record<string, { state: string; settings: any; exceptions: string[], minSupportedVersion?: string|number }>; unprotectedTemporary: string[]; }} data
 * @param {string[]} userList
 * @param {UserPreferences} preferences
 * @param {string[]} platformSpecificFeatures
 */
export function processConfig (data, userList, preferences, platformSpecificFeatures = []) {
    const topLevelHostname = getTabHostname()
    const allowlisted = userList.filter(domain => domain === topLevelHostname).length > 0
    const remoteFeatureNames = Object.keys(data.features)
    const platformSpecificFeaturesNotInRemoteConfig = platformSpecificFeatures.filter((featureName) => !remoteFeatureNames.includes(featureName))
    /** @type {Record<string, any>} */
    const output = { ...preferences }
    if (output.platform) {
        const version = getPlatformVersion(preferences)
        if (version) {
            output.platform.version = version
        }
    }
    const enabledFeatures = remoteFeatureNames.filter((featureName) => {
        const feature = data.features[featureName]
        // Check that the platform supports minSupportedVersion checks and that the feature has a minSupportedVersion
        if (feature.minSupportedVersion && preferences.platform?.version) {
            if (!isSupportedVersion(feature.minSupportedVersion, preferences.platform.version)) {
                return false
            }
        }
        return feature.state === 'enabled' && !isUnprotectedDomain(topLevelHostname, feature.exceptions)
    }).concat(platformSpecificFeaturesNotInRemoteConfig) // only disable platform specific features if it's explicitly disabled in remote config
    const isBroken = isUnprotectedDomain(topLevelHostname, data.unprotectedTemporary)
    output.site = {
        domain: topLevelHostname,
        isBroken,
        allowlisted,
        enabledFeatures
    }
    // TODO
    output.cookie = {}

    // Copy feature settings from remote config to preferences object
    output.featureSettings = {}
    remoteFeatureNames.forEach((featureName) => {
        if (!enabledFeatures.includes(featureName)) {
            return
        }

        output.featureSettings[featureName] = data.features[featureName].settings
    })

    return output
}

export function isGloballyDisabled (args) {
    return args.site.allowlisted || args.site.isBroken
}

export const windowsSpecificFeatures = ['windowsPermissionUsage']

export function isWindowsSpecificFeature (featureName) {
    return windowsSpecificFeatures.includes(featureName)
}

export function createCustomEvent (eventName, eventDetail) {
    // By default, Firefox protects the event detail Object from the page,
    // leading to "Permission denied to access property" errors.
    // See https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
    if (hasMozProxies) {
        eventDetail = cloneInto(eventDetail, window)
    }

    return new OriginalCustomEvent(eventName, eventDetail)
}

export function sendMessage (messageType, options) {
    // FF & Chrome
    return originalWindowDispatchEvent(createCustomEvent('sendMessageProxy' + messageSecret, { detail: { messageType, options } }))
    // TBD other platforms
}
