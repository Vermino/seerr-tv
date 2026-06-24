# Keep JavaScript interface methods if any are added later.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
