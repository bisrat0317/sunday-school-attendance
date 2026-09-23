// Bilingual Dictionary: English & Amharic (አማርኛ)
const translations = {
  en: {
    appTitle: "Sunday School Attendance",
    appSubtitle: "Student Management & Attendance Tracking System",
    welcome: "Welcome",
    login: "Login",
    logout: "Logout",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    loggingIn: "Signing in...",
    adminRole: "Administrator",
    encoderRole: "Encoder",

    // Navigation
    navDashboard: "Dashboard",
    navSessions: "Sessions",
    navStudents: "Students",
    navAlerts: "3-Absent Alerts",
    navInactive: "Inactive Students",
    navUsers: "User Management",
    navCategoryMatrix: "Category Matrix & Export",

    // Dashboard Cards
    totalStudents: "Total Students",
    activeStudents: "Active Students",
    totalSessions: "Total Sessions",
    overallRate: "Attendance Rate",
    categoryBreakdown: "Category Breakdown",
    recentSessions: "Recent Sessions",

    // 3-Absent Alerts
    alertsTitle: "3 Consecutive Absences - Urgent Follow-up",
    alertsSubtitle: "Students who have missed the last 3 consecutive sessions in their category",
    noAlerts: "Praise God! No students have missed 3 consecutive sessions.",
    callStudent: "Call Phone",
    callEmergency: "Call Emergency",
    lastPresentDate: "Last Present Date",
    consecutiveAbsences: "Consecutive Absences",

    // Inactive Students
    inactiveTitle: "Inactive Students",
    inactiveSubtitle: "Students marked as inactive in Sunday School",
    noInactive: "No inactive students found.",
    activate: "Set Active",
    deactivate: "Set Inactive",

    // Sessions
    sessionsTitle: "Sunday School Sessions",
    createSession: "+ Create New Session",
    courseTitle: "Course / Topic Title",
    sessionDate: "Date",
    sessionTime: "Time / Hour",
    category: "Category",
    description: "Description / Notes",
    takeAttendance: "Take Attendance",
    viewAttendance: "View Attendance",
    statusPresent: "Present",
    statusAbsent: "Absent",
    statusPermission: "Permission",
    markedCount: "Marked",

    // Attendance Sheet Modal
    attendanceSheet: "Attendance Sheet",
    markAllPresent: "Mark All Present",
    saveAttendance: "Save Attendance",
    savingAttendance: "Saving...",
    searchStudent: "Search student by name or phone...",
    studentName: "Student Name",
    parentsName: "Parents",
    contact: "Contact",
    status: "Status",
    remarks: "Remarks / Notes",

    // Students
    studentsTitle: "Sunday School Students",
    registerStudent: "+ Register New Student",
    filterCategory: "Filter Category",
    allCategories: "All Categories",
    filterStatus: "Filter Status",
    allStatuses: "All Statuses",
    active: "Active",
    inactive: "Inactive",
    firstName: "First Name",
    fatherName: "Father's Name",
    motherName: "Mother's Name",
    age: "Age",
    phone: "Phone Number",
    emergencyContact: "Emergency / Secondary Contact",
    profession: "Profession / Education",
    previousService: "Previous Church Service",
    actions: "Actions",
    viewProfile: "Profile & History",
    edit: "Edit",
    delete: "Delete",
    confirmDelete: "Are you sure you want to delete this?",

    // Categories
    catChild: "Child (ህፃናት)",
    catTeens: "Teens (አዳጊዎች)",
    catYouth: "Youth (ወጣቶች)",
    catAdult: "Adult (አዋቂዎች)",
    catAll: "All (ለሁሉም)",

    // User Management
    usersTitle: "System Users (Encoders & Admins)",
    addUser: "+ Add New User",
    fullName: "Full Name",
    role: "System Role",
    createdDate: "Created Date",

    // Excel Export
    exportExcel: "Export Excel",
    exportStudentsList: "Export Students (Excel)",
    exportMasterMatrix: "Master Attendance Register (Excel)",
    categoryMatrixTitle: "Category Attendance Matrix Register",
    categoryMatrixSubtitle: "Live attendance grid filtered by category and student registration date",
    regDate: "Registration Date",

    // Form buttons
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    loading: "Loading..."
  },

  am: {
    appTitle: "የሰንበት ት/ቤት የመገኘት መቆጣጠሪያ",
    appSubtitle: "የተማሪዎች ምዝገባ እና የመገኘት ክትትል ሥርዓት",
    welcome: "እንኳን ደህና መጡ",
    login: "ግባ",
    logout: "ውጣ",
    username: "የተጠቃሚ ስም",
    password: "የይለፍ ቃል",
    signIn: "ግባ",
    loggingIn: "በመግባት ላይ...",
    adminRole: "ዋና አስተዳዳሪ (Admin)",
    encoderRole: "መዝጋቢ (Encoder)",

    // Navigation
    navDashboard: "ዳሽቦርድ / ሪፖርት",
    navSessions: "የትምህርት ክፍለ-ጊዜያት",
    navStudents: "የተማሪዎች ዝርዝር",
    navAlerts: "የ 3 ሳምንት የቀሩ (ማስጠንቀቂያ)",
    navInactive: "እንቅስቃሴ ያቆሙ",
    navUsers: "የተጠቃሚዎች አስተዳደር",

    // Dashboard Cards
    totalStudents: "አጠቃላይ ተማሪዎች",
    activeStudents: "ንቁ ተማሪዎች",
    totalSessions: "የተካሄዱ ክፍለ-ጊዜያት",
    overallRate: "የመገኘት መጠን",
    categoryBreakdown: "የተማሪዎች ምድብ ብዛት",
    recentSessions: "የቅርብ ጊዜ ክፍለ-ጊዜያት",

    // 3-Absent Alerts
    alertsTitle: "3 ተከታታይ ሳምንት የቀሩ ተማሪዎች (አስቸኳይ ክትትል)",
    alertsSubtitle: "በምድባቸው በተከታታይ 3 ሳምንት ያልተገኙ እና ክትትል የሚሹ ተማሪዎች",
    noAlerts: "እግዚአብሔር ይመስገን! 3 ሳምንት በተከታታይ የቀረ ተማሪ የለም።",
    callStudent: "ለተማሪው ደውል",
    callEmergency: "ለአደጋ ጊዜ ስልክ ደውል",
    lastPresentDate: "የመጨረሻ የተገኘበት ቀን",
    consecutiveAbsences: "የቀረበት ተከታታይ ጊዜ",

    // Inactive Students
    inactiveTitle: "እንቅስቃሴ ያቆሙ ተማሪዎች",
    inactiveSubtitle: "በሰንበት ት/ቤቱ እንቅስቃሴ ያቆሙ ተማሪዎች ዝርዝር",
    noInactive: "እንቅስቃሴ ያቆመ ተማሪ የለም።",
    activate: "ወደ ንቁ መልስ",
    deactivate: "እንቅስቃሴ ያቆመ አድርግ",

    // Sessions
    sessionsTitle: "የትምህርት ክፍለ-ጊዜያት",
    createSession: "+ አዲስ ክፍለ-ጊዜ ፍጠር",
    courseTitle: "የትምህርቱ ርዕስ",
    sessionDate: "ቀን",
    sessionTime: "ሰዓት",
    category: "ምድብ",
    description: "ማብራሪያ / ማስታወሻ",
    takeAttendance: "መገኘት መዝግብ",
    viewAttendance: "መገኘት ተመልከት",
    statusPresent: "ተገኝቷል",
    statusAbsent: "ቀረ",
    statusPermission: "ፈቃድ",
    markedCount: "የተመዘገቡ",

    // Attendance Sheet Modal
    attendanceSheet: "የመገኘት መመዝገቢያ ቅጽ",
    markAllPresent: "ሁሉንም ተገኝቷል በል",
    saveAttendance: "መገኘቱን መዝግብ",
    savingAttendance: "በመመዝገብ ላይ...",
    searchStudent: "ተማሪ በስም ወይም በስልክ ፈልግ...",
    studentName: "የተማሪው ስም",
    parentsName: "የወላጆች ስም",
    contact: "ስልክ",
    status: "ሁኔታ",
    remarks: "አስተያየት",

    // Students
    studentsTitle: "የሰንበት ት/ቤት ተማሪዎች",
    registerStudent: "+ አዲስ ተማሪ መዝግብ",
    filterCategory: "በምድብ ለይ",
    allCategories: "ሁሉም ምድቦች",
    filterStatus: "በሁኔታ ለይ",
    allStatuses: "ሁሉም",
    active: "ንቁ",
    inactive: "እንቅስቃሴ ያቆመ",
    firstName: "የተማሪው ስም",
    fatherName: "የአባት ስም",
    motherName: "የእናት ስም",
    age: "ዕድሜ",
    phone: "ስልክ ቁጥር",
    emergencyContact: "የአደጋ ጊዜ / አማራጭ ስልክ",
    profession: "ሙያ / የትምህርት ደረጃ",
    previousService: "ቀደም ሲል ያገለገሉበት ክፍል",
    actions: "ድርጊት",
    viewProfile: "ሙሉ መረጃ እና ታሪክ",
    edit: "አስተካክል",
    delete: "ሰርዝ",
    confirmDelete: "ይህን መረጃ በእርግጥ መሰረዝ ይፈልጋሉ?",

    // Categories
    catChild: "ህፃናት (Child)",
    catTeens: "አዳጊዎች (Teens)",
    catYouth: "ወጣቶች (Youth)",
    catAdult: "አዋቂዎች (Adult)",
    catAll: "ለሁሉም (All)",

    // User Management
    usersTitle: "የስርዓቱ ተጠቃሚዎች (መዝጋቢዎችና አስተዳዳሪዎች)",
    addUser: "+ አዲስ ተጠቃሚ ጨምር",
    fullName: "ሙሉ ስም",
    role: "የሥራ ድርሻ",
    createdDate: "የተመዘገበበት ቀን",

    // Excel Export
    exportExcel: "በ-Excel አውርድ",
    exportStudentsList: "የተማሪዎች መረጃ በ-Excel አውርድ",
    exportMasterMatrix: "የአስተዳደር አጠቃላይ መገኘት መዝገብ (Excel)",
    categoryMatrixTitle: "የምድብ መገኘት መዝገብ እና Excel ማውረጃ",
    categoryMatrixSubtitle: "የተማሪዎችን መዝገብ የተመዘገቡበትን ቀን መሠረት ያደረገ መቆጣጠሪያ",
    regDate: "የተመዘገበበት ቀን",

    // Form buttons
    save: "መዝግብ",
    cancel: "ተመለስ",
    close: "ዝጋ",
    loading: "በመጫን ላይ..."
  }
};

