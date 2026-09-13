package com.mofa.chat;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 应用内更新：DownloadManager 下载 APK（系统通知栏可见进度），
 * 完成后通过 content:// Uri 拉起系统安装器（需 REQUEST_INSTALL_PACKAGES 权限）。
 */
@CapacitorPlugin(name = "Updater")
public class Updater extends Plugin {

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
                    int status = cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        Uri apkUri = manager.getUriForDownloadedFile(downloadId);
                        if (apkUri != null) {
                            Intent install = new Intent(Intent.ACTION_VIEW);
                            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            context.startActivity(install);
                        }
                    }
                    cursor.close();
                }
            }
        };
        ctx.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }
}
