package com.mofa.chat;

import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册应用内更新插件（本地插件，无需 npm 包）
        registerPlugin(Updater.class);
        super.onCreate(savedInstanceState);
        applyEdgeToEdgeInsets();
    }

    /**
     * Android 15（targetSdk 35）强制 edge-to-edge 后 adjustResize 失效，
     * Capacitor 自带的边距处理只算系统栏、并把 insets 吞掉，键盘弹出时 WebView 不会变矮，
     * 输入框就被盖住。这里接管 WebView 的 insets：键盘可见时底部留出键盘高度。
     */
    private void applyEdgeToEdgeInsets() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        if (getBridge() == null) return;

        WebView webView = getBridge().getWebView();
        if (webView == null || !(webView.getLayoutParams() instanceof ViewGroup.MarginLayoutParams)) return;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            int bottom = keyboardVisible ? ime.bottom : bars.bottom;

            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            // 只在边距真的变了才改：每次 insets 分发都 setLayoutParams 会让 WebView 整块重新布局/重绘，
            // 部分机型上表现为空白页过一会儿闪一下（系统栏状态一变就触发一次）
            if (mlp.leftMargin != bars.left
                    || mlp.rightMargin != bars.right
                    || mlp.topMargin != bars.top
                    || mlp.bottomMargin != bottom) {
                mlp.leftMargin = bars.left;
                mlp.rightMargin = bars.right;
                mlp.topMargin = bars.top;
                mlp.bottomMargin = bottom;
                view.setLayoutParams(mlp);
            }

            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
