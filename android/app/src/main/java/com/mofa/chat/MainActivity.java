package com.mofa.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册应用内更新插件（本地插件，无需 npm 包）
        registerPlugin(Updater.class);
        super.onCreate(savedInstanceState);
    }
}
