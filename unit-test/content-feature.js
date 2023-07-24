import ContentFeature from '../src/content-feature.js'

describe('ContentFeature class', () => {
    it('Should trigger getFeatureSettingEnabled for the correct domain', () => {
        let didRun = false
        class MyTestFeature extends ContentFeature {
            init () {
                expect(this.getFeatureSetting('test')).toBe('enabled3')
                expect(this.getFeatureSetting('otherTest')).toBe('enabled')
                expect(this.getFeatureSetting('otherOtherTest')).toBe('ding')
                expect(this.getFeatureSetting('arrayTest')).toBe('enabledArray')
                didRun = true
            }
        }
        const me = new MyTestFeature('test')
        me.callInit({
            site: {
                domain: 'beep.example.com'
            },
            featureSettings: {
                test: {
                    test: 'enabled',
                    otherTest: 'disabled',
                    otherOtherTest: 'ding',
                    arrayTest: 'enabled',
                    domains: [
                        {
                            domain: 'example.com',
                            patchSettings: [
                                { op: 'replace', path: '/test', value: 'enabled2' },
                                { op: 'replace', path: '/otherTest', value: 'enabled' }
                            ]
                        },
                        {
                            domain: 'beep.example.com',
                            patchSettings: [
                                { op: 'replace', path: '/test', value: 'enabled3' }
                            ]
                        },
                        {
                            domain: ['meep.com', 'example.com'],
                            patchSettings: [
                                { op: 'replace', path: '/arrayTest', value: 'enabledArray' }
                            ]
                        }
                    ]
                }
            }
        })
        expect(didRun).withContext('Should run').toBeTrue()
    })

    it('addDebugFlag should send a message to the background', () => {
        class MyTestFeature extends ContentFeature {
            // eslint-disable-next-line
            // @ts-ignore partial mock
            messaging = {
                notify () {
                    console.log('AAAAA', arguments)
                }
            }
        }
        const feature = new MyTestFeature('someFeatureName')
        const spyNotify = spyOn(feature.messaging, 'notify')
        feature.addDebugFlag('someflag')
        expect(spyNotify).toHaveBeenCalledWith(
            'addDebugFlag',
            {
                flag: 'someFeatureName.someflag'
            }
        )
    })
})
