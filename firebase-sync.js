(function () {
  const BOOKINGS_KEY = 'newEraMmaBookingsApp';
  const USERS_KEY = 'newEraMmaUsersApp';
  const SESSION_USER_KEY = 'newEraMmaSessionUserApp';
  const DEFAULT_CONFIG = {
  apiKey: "AIzaSyCn08tRZbpmfC6xNb0NWalbsdKzKWRvlrk",
  authDomain: "new-era-a8352.firebaseapp.com",
  projectId: "new-era-a8352",
  storageBucket: "new-era-a8352.firebasestorage.app",
  messagingSenderId: "7154910283",
  appId: "1:7154910283:web:b43fac75f9779b0bb879ce"
};

  const config = window.NEW_ERA_FIREBASE_CONFIG || DEFAULT_CONFIG;
  const hasFirebaseSdk = typeof window.firebase !== 'undefined';
  const isConfigured = hasFirebaseSdk && Object.values(config).every(value => typeof value === 'string' && value && !value.startsWith('YOUR_'));
  const listeners = {
    bookings: new Set(),
    users: new Set()
  };

  let db = null;
  let auth = null;
  let bookingsUnsubscribe = null;
  let userUnsubscribe = null;
  let currentAuthUserId = null;
  let sessionProfile = loadSessionProfile();
  let bookingsCache = loadLocal(BOOKINGS_KEY);
  let usersCache = loadLocal(USERS_KEY);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadLocal(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (error) {
      return [];
    }
  }

  function loadSessionProfile() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_USER_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function saveLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function notify(type) {
    const payload = type === 'bookings' ? clone(bookingsCache) : clone(usersCache);
    listeners[type].forEach(listener => listener(payload));
  }

  function setBookingsCache(nextBookings) {
    bookingsCache = clone(nextBookings);
    saveLocal(BOOKINGS_KEY, bookingsCache);
    notify('bookings');
  }

  function setUsersCache(nextUsers) {
    usersCache = clone(nextUsers);
    saveLocal(USERS_KEY, usersCache);
    notify('users');
  }

  async function upsertCollection(collectionName, items) {
    if (!db) return;
    const batch = db.batch();
    items.forEach(item => {
      if (!item || !item.id) return;
      const ref = db.collection(collectionName).doc(item.id);
      const payload = { ...item };
      delete payload.id;
      batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
  }

  async function upsertDocument(collectionName, item) {
    if (!db || !item || !item.id) return item;
    const payload = { ...item };
    delete payload.id;
    await db.collection(collectionName).doc(item.id).set(payload, { merge: true });
    return item;
  }

  function stopFirebaseListeners() {
    if (bookingsUnsubscribe) {
      bookingsUnsubscribe();
      bookingsUnsubscribe = null;
    }
    if (userUnsubscribe) {
      userUnsubscribe();
      userUnsubscribe = null;
    }
  }

  function getCurrentUserProfile() {
    const syncedProfile = usersCache.find(user => user.id === currentAuthUserId);
    if (syncedProfile) {
      return syncedProfile;
    }

    if (sessionProfile && sessionProfile.id === currentAuthUserId) {
      return clone(sessionProfile);
    }

    return null;
  }

  function setSessionUser(user) {
    sessionProfile = user ? clone(user) : null;

    if (!currentAuthUserId) {
      return;
    }

    if (!sessionProfile || sessionProfile.id === currentAuthUserId) {
      bindBookingsListener();
    }
  }

  function bindBookingsListener() {
    if (!db || !currentAuthUserId) {
      setBookingsCache([]);
      return;
    }

    if (bookingsUnsubscribe) {
      bookingsUnsubscribe();
      bookingsUnsubscribe = null;
    }

    const profile = getCurrentUserProfile();
    if (!profile) {
      setBookingsCache([]);
      return;
    }

    const query = profile.role === 'coach'
      ? db.collection('bookings').where('coach', '==', profile.coachId)
      : db.collection('bookings').where('clientId', '==', currentAuthUserId);

    bookingsUnsubscribe = query.onSnapshot(snapshot => {
      const nextBookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBookingsCache(nextBookings);
    }, error => {
      console.error('Firestore bookings subscription failed.', error);
    });
  }

  function bindUserListener(userId) {
    if (!db || !userId) {
      setUsersCache([]);
      setBookingsCache([]);
      return;
    }

    if (userUnsubscribe) {
      userUnsubscribe();
      userUnsubscribe = null;
    }

    userUnsubscribe = db.collection('users').doc(userId).onSnapshot(doc => {
      const nextUsers = doc.exists ? [{ id: doc.id, ...doc.data() }] : [];
      setUsersCache(nextUsers);
      bindBookingsListener();
    }, error => {
      console.error('Firestore user subscription failed.', error);
    });
  }

  function subscribe(type, listener) {
    listeners[type].add(listener);
    listener(type === 'bookings' ? clone(bookingsCache) : clone(usersCache));
    return function unsubscribe() {
      listeners[type].delete(listener);
    };
  }

  async function saveBookings(nextBookings) {
    setBookingsCache(nextBookings);
    await upsertCollection('bookings', bookingsCache);
  }

  async function saveUsers(nextUsers) {
    setUsersCache(nextUsers);
    await upsertCollection('users', usersCache);
  }

  async function addBooking(booking) {
    const nextBooking = { ...booking, id: booking.id || `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const nextBookings = bookingsCache.filter(item => item.id !== nextBooking.id);
    nextBookings.push(nextBooking);
    setBookingsCache(nextBookings);
    await upsertDocument('bookings', nextBooking);
    return nextBooking;
  }

  async function upsertBooking(booking) {
    const nextBooking = { ...booking, id: booking.id || `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const nextBookings = bookingsCache.filter(item => item.id !== nextBooking.id);
    nextBookings.push(nextBooking);
    setBookingsCache(nextBookings);
    await upsertDocument('bookings', nextBooking);
    return nextBooking;
  }

  async function upsertUser(user) {
    const nextUser = { ...user, id: user.id || `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const nextUsers = usersCache.filter(item => item.id !== nextUser.id);
    nextUsers.push(nextUser);
    setUsersCache(nextUsers);
    await upsertDocument('users', nextUser);
    return nextUser;
  }

  function initFirebase() {
    if (!isConfigured) return;

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }

    db = firebase.firestore();
    auth = firebase.auth();

    setBookingsCache([]);
    setUsersCache([]);

    auth.onAuthStateChanged(user => {
      currentAuthUserId = user ? user.uid : null;
      stopFirebaseListeners();

      if (!currentAuthUserId) {
        sessionProfile = null;
        setBookingsCache([]);
        setUsersCache([]);
        return;
      }

      bindUserListener(currentAuthUserId);
    });
  }

  initFirebase();

  window.newEraRealtime = {
    isConfigured,
    getBookings: function getBookings() {
      return clone(bookingsCache);
    },
    saveBookings,
    addBooking,
    upsertBooking,
    subscribeBookings: function subscribeBookings(listener) {
      return subscribe('bookings', listener);
    },
    getUsers: function getUsers() {
      return clone(usersCache);
    },
    saveUsers,
    upsertUser,
    setSessionUser,
    subscribeUsers: function subscribeUsers(listener) {
      return subscribe('users', listener);
    }
  };
})();