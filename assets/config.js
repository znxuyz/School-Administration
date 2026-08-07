// Firebase 專案設定。
// 這段設定屬於公開資訊,放在前端是 Firebase 的正常用法;
// 真正的存取控管由 firestore.rules 與 Authentication 授權網域負責。
export const firebaseConfig = {
  apiKey: "AIzaSyDsrfdv_NlT_9raP4lHqhXqzSM8wZ7CAjc",
  authDomain: "school-administration-39b08.firebaseapp.com",
  projectId: "school-administration-39b08",
  storageBucket: "school-administration-39b08.firebasestorage.app",
  messagingSenderId: "588975168758",
  appId: "1:588975168758:web:7c856a9a7140d3216420d7"
};

// 處室清單,可自行增刪。
export const DEPARTMENTS = [
  "校長室",
  "教務處",
  "學務處",
  "總務處",
  "輔導室",
  "人事室",
  "會計室",
  "圖書館",
  "幼兒園",
  "其他"
];

// 超過這個天數沒有更新,且尚未完成的計畫會被標為「待更新」。
export const STALE_DAYS = 14;
