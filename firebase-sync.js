(function () {
  const BOOKINGS_KEY = 'newEraMmaBookingsApp';
  const USERS_KEY = 'newEraMmaUsersApp';
  const DEFAULT_CONFIG = {
  apiKey: "AIzaSyCd7cvPkJFWbnnSrDtP66I-j2Waynw18AA",
  authDomain: "new-era-27105.firebaseapp.com",
  projectId: "new-era-27105",
  storageBucket: "new-era-27105.firebasestorage.app",
  messagingSenderId: "333704335255",
  appId: "1:333704335255:web:7dd8ede1577155b9f07ed2"
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
    return usersCache.find(user => user.id === currentAuthUserId) || null;
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
    subscribeUsers: function subscribeUsers(listener) {
      return subscribe('users', listener);
    }
  };
})();