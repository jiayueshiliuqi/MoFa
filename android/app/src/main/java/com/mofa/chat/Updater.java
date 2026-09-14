package com.mofa.chat;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.widget.Toast;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 应用内更新：
 * - fetchJson：原生发起版本检查请求（不受 WebView 的 CORS / 混合内容限制）
 * - downloadAndInstall：DownloadManager 下载 APK（通知栏显示进度），
 *   完成后通过 content:// Uri 拉起系统安装器（需 REQUEST_INSTALL_PACKAGES 权限）
 */
@CapacitorPlugin(name = "Updater")
public class Updater extends Plugin {

    /** 原生 HTTP GET：绕过 WebView 的跨域与混合内容限制 */
    @PluginMethod
    public void fetchJson(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final int timeout = call.getInt("timeout", 10000);

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(timeout);
                conn.setReadTimeout(timeout);
                conn.setRequestProperty("Accept", "application/json");
                // 禁用缓存，保证拿到最新版本信息
                conn.setUseCaches(false);
                conn.setRequestProperty("Cache-Control", "no-cache");

                int code = conn.getResponseCode();
                InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (stream != null) {
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line).append('\n');
                    }
                }

                if (code < 200 || code >= 300) {
                    call.reject("HTTP " + code);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("body", sb.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "network error" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        Context ctx = getContext();
        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("DownloadManager unavailable");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("MoFa 更新");
        request.setDescription("下载完成后自动弹出安装");
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "MoFa-update.apk");

        final long downloadId = dm.enqueue(request);
        final DownloadManager manager = dm;

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long ref = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (ref != downloadId) return;
                try {
                    context.unregisterReceiver(this);
                } catch (Exception ignored) {
                }
                DownloadManager.Query query = new DownloadManager.Query();
                query.setFilterById(downloadId);
                Cursor cursor = manager.query(query);
                if (cursor != null && cursor.moveToFirst()) {
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        Uri apkUri = manager.getUriForDownloadedFile(downloadId);
                        if (apkUri != null) {
                            Intent install = new Intent(Intent.ACTION_VIEW);
                            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            context.startActivity(install);
                        }
                    } else if (status == DownloadManager.STATUS_FAILED || status == DownloadManager.STATUS_PAUSED) {
                        Toast.makeText(context.getApplicationContext(), "下载失败，请稍后重试", Toast.LENGTH_LONG).show();
                    }
                    cursor.close();
                }
            }
        };
        // targetSdk 34+ 要求显式声明接收器是否导出；系统广播用 ContextCompat 兼容注册
        ContextCompat.registerReceiver(
                ctx,
                receiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_NOT_EXPORTED);

        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }
}
