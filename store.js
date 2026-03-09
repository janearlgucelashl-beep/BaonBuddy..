const DB_NAME = 'BaonBuddyDB';
const STORE_NAME = 'app_state';
const STATE_KEY = 'current_state';
const OLD_STORAGE_KEY = 'savings_tracker_data';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export const Store = {
    async save(data) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(data, STATE_KEY);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async load() {
        // Try IndexedDB first
        const db = await openDB();
        let data = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(STATE_KEY);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        // Migration from LocalStorage if IndexedDB is empty
        if (!data) {
            const localData = localStorage.getItem(OLD_STORAGE_KEY);
            if (localData) {
                try {
                    data = JSON.parse(localData);
                    // Save to IndexedDB for future
                    await this.save(data);
                    // Optional: localStorage.removeItem(OLD_STORAGE_KEY); 
                } catch (e) {
                    console.error("Migration failed", e);
                }
            }
        }

        const defaultState = {
            tosAgreed: false,
            plans: [],
            totalSavings: 0,
            totalSpent: 0,
            lastLoginDate: '', // Initialize empty to trigger first-time logic
            history: [],
            settings: {
                currency: '₱',
                timezone: 'Asia/Manila',
                resetTime: '00:00',
                excludedDays: [0, 6] // Default Sun, Sat
            },
            exclusionSets: []
        };

        if (!data) return defaultState;
        
        return { ...defaultState, ...data };
    }
};