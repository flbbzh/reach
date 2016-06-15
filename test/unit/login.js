import Reach from '../../src/Reach';
import * as datasync from '../../src/core/util/DataSync';
import * as rules from '../util/rules';
import * as log from '../util/logger';
import * as namespace from '../util/namespace';
import {CONNECTED, NOT_CONNECTED} from '../../src/core/util/constants';
import Device from '../../src/core/Device';

const uidRegExp = /^[a-z0-9\-:]+$/;

const testUser = (done, action, userInfos, ereg = uidRegExp) => {
	action
		.then(user => {
			expect(user.name).toEqual(userInfos.name || userInfos.email);
			expect(user.status).toEqual(CONNECTED);
			expect(user.uid).toMatch(ereg);
			return datasync.get(`users/${user.uid}`);
		})
		.then(snapData => {
			const val = snapData.val();
			expect(val).not.toBeNull();
			expect(val.name).toEqual(userInfos.name || userInfos.email);
			expect(val.lastSeen).toMatch(/^\d+$/);
			return datasync.get(`_/devices/${snapData.name()}`);
		})
		.then(snapData => {
			const devices = snapData.val();
			expect(snapData.numChildren()).toEqual(1);
			const device = devices[Object.keys(devices)[0]];
			expect(device.status).toEqual(CONNECTED);
			expect(device.sdk).not.toBeNull();
		})
		.then(done)
		.catch(e => {
			fail(e.message);
			done(e);
		});
};

export default () => {
	describe('Register & Login /', () => {
		let ref;

		beforeEach(done => {
			ref = new Reach(config.base);
			done();
		});

		afterEach(done => {
			ref.logout().then(done, done);
		});

		describe('Authenticated Users /', () => {

			it('Should be able to register a new user', done => {
				const newUser = {
					email: `register.user.${Date.now()}@reach.io`,
					password: 'password'
				};
				config.createdUsers.push(newUser);
				testUser(
					done,
					ref.register(
						newUser.email,
						newUser.password
					),
					newUser
				);
			});
	
			it('Should be able to login as an existing user', done => {
				testUser(
					done,
					ref.login(
						config.createdUsers[1].email,
						config.createdUsers[1].password,
						'Homer'
					),
					Object.assign({name: 'Homer'}, config.createdUsers[0])
				);
			});
	
			it('Should be able to logout', done => {
				ref.login(
					config.createdUsers[1].email,
					config.createdUsers[1].password,
					'Homer'
				).then(user => {
					expect(ref.current).toEqual(user);
					return ref.logout();
				}).then(() => {
					expect(ref.current).toBeNull();
					return namespace.get(`users/${config.createdUsers[1].uid}/status`);
				}).then(snap => {
					if (snap) {
						expect(snap.val()).toBe(NOT_CONNECTED);
					} else {
						fail('Cannot get User\'s status');
					}
				})
				.then(() => done())
				.catch(e => {
					log.e(e);
					done(e);
				});
			});
	
			it('Should be able to resume a previous session', done => {
				config.base.authWithPassword(Object.assign({rememberMe: true}, config.createdUsers[3])).then(() => {
					config.base.unauth();
					// Reset repos to force new persistent connection to be established
					Webcom.Context.getInstance().repos_ = {};
					testUser(
						done,
						ref.resume(),
						Object.assign({name: config.createdUsers[3].email}, config.createdUsers[3])
					);
				});
			});

			it('Should be CONNECTED after logout if at least one device is connected', done => {
				ref.login(
					config.createdUsers[0].email,
					config.createdUsers[0].password,
					'Homer'
				)
				.then(user => {
					expect(ref.current).toEqual(user);
					return user.devices();
				})
				.then(devices => {
					expect(devices).toBeAnArrayOf(Device);
					expect(devices.length).toBe(3);
					expect(devices.filter(device => device.status === CONNECTED).length).toBe(3);
				})
				.then(() => ref.logout())
				.then(() => {
					expect(ref.current).toBeNull();
					return namespace.get(`users/${config.createdUsers[0].uid}/status`);
				})
				.then(snap => {
					if (snap) {
						expect(snap.val()).toBe(CONNECTED);
					} else {
						fail('Cannot get User\'s status');
					}
				})
				.then(() => done())
				.catch(e => {
					log.e(e);
					done(e);
				});
			});
		});
	
		describe('Anonymous Users /', () => {

			beforeAll(done => {
				log.d('login#anon#beforeAll');
				rules.set({'.read': true, '.write': true})
					.then(() => {
						// Reset repos to force new persistent connection to be established
						Webcom.Context.getInstance().repos_ = {};
						done();
					})
					.catch(e => {
						log.e('login#anon#beforeAll', e);
						done(e);
					});
			});

			it('Should be able to login as an anonymous user', done => {
				testUser(
					done,
					ref.anonymous('Homer'),
					{name: 'Homer'},
					/^anonymous:\d+$/
				);
			});

			afterAll(done => {
				log.d('login#anon#afterAll');
				rules.set(config.rules)
					.then(done)
					.catch(e => {
						log.e('login#anon#afterAll', e);
						done(e);
					});
			});
		});
	});
};
