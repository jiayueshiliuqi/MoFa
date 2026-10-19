package com.mofa.chat;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 应用内更新：
 * - fetchJson：原生发起版本检查请求（不受 WebView 的 CORS / 混合内容限制）
 * - downloadAndInstall：应用内流式下载 APK，边下边通过 downloadProgress 事件上报进度，
 *   完成后用 FileProvider 调起系统安装器（普通应用无法静默安装，最后一步仍需用户点「安装」）。
 */
@CapacitorPlugin(name = "Updater")
public class Updater extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private volatile boolean canceled = false;
    private volatile HttpURLConnection activeConn = null;
    private volatile Thread downloadThread = null;

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

    /** 是否已允许「安装未知应用」（Android 8 以下默认允许） */
    @PluginMethod
    public void hasInstallPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canInstall());
        call.resolve(ret);
    }

    /**
     * 请求安装权限：系统没有运行时弹窗，只能跳到「安装未知应用」设置页由用户手动打开。
     * 返回 started 表示已跳转；调用方应在应用回到前台后重新用 hasInstallPermission 确认。
     */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (canInstall()) {
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (!openInstallSettings()) {
            call.reject("无法打开安装权限设置页");
            return;
        }
        ret.put("started", true);
        call.resolve(ret);
    }

    /**
     * 清理缓存目录里遗留的安装包（更新完成并重启后调用，避免缓存越攒越大）。
     * 只会删除 updates 目录下的 .apk / .part。
     */
    @PluginMethod
    public void clearUpdateCache(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "updates");
        int removed = 0;
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.getName().endsWith(".apk") || f.getName().endsWith(".part")) {
                    if (f.delete()) removed++;
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("removed", removed);
        call.resolve(ret);
    }

    /**
     * 应用内下载 APK：流式写入应用缓存目录，期间 emit downloadProgress（0~100）。
     * 下载完成后校验文件并调起系统安装器。
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        // 只允许 http(s)，避免 file:// 等 scheme 触发异常
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("invalid url");
            return;
        }
        if (downloadThread != null && downloadThread.isAlive()) {
            call.reject("已有更新正在下载");
            return;
        }
        // 下载前就要求权限：否则下完才被拦下，用户授权后又要重新下载
        if (!canInstall()) {
            openInstallSettings();
            call.reject("请先允许安装未知应用");
            return;
        }

        final Context ctx = getContext();
        final File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("无法创建下载目录");
            return;
        }
        final String baseName = "mofa-update-" + System.currentTimeMillis();
        final File part = new File(dir, baseName + ".apk.part");
        final File apk = new File(dir, baseName + ".apk");

        canceled = false;
        downloadThread = new Thread(() -> {
            HttpURLConnection conn = null;
            FileOutputStream out = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                activeConn = conn;
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setInstanceFollowRedirects(true);
                conn.setUseCaches(false);
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
                conn.setRequestProperty("User-Agent", "MoFa-Updater");

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
                // getContentLengthLong 需要 API 24，minSdk 23 上会 NoSuchMethodError；APK 不会超过 2GB
                final long total = conn.getContentLength();
                if (total <= 0) throw new IOException("无法获取更新包大小");

                out = new FileOutputStream(part);
                InputStream in = new BufferedInputStream(conn.getInputStream(), 16 * 1024);
                byte[] buf = new byte[16 * 1024];
                long received = 0;
                int lastPercent = -1;
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (canceled) throw new IOException("已取消");
                    out.write(buf, 0, n);
                    received += n;
                    int percent = (int) Math.min(100, received * 100 / total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        emitProgress(percent, received, total);
                    }
                }
                out.flush();
                out.close();
                out = null;

                if (received != total) throw new IOException("下载不完整，请重试");
                if (!isZip(part)) throw new IOException("下载内容不是有效的安装包");
                if (!part.renameTo(apk)) throw new IOException("保存安装包失败");
                emitProgress(100, received, total);

                installApk(ctx, apk);
                call.resolve();
            } catch (Exception e) {
                if (part.exists()) part.delete();
                String msg = canceled ? "已取消" : (e.getMessage() == null ? "下载失败" : e.getMessage());
                call.reject(msg);
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (IOException ignored) {
                    }
                }
                if (conn != null) conn.disconnect();
                activeConn = null;
                cleanupOld(dir, apk);
            }
        }, "mofa-update-download");
        downloadThread.start();
    }

    /** 取消正在进行的下载（前端进度条上的「取消」） */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        canceled = true;
        HttpURLConnection conn = activeConn;
        if (conn != null) {
            try {
                conn.disconnect();
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    private void emitProgress(int percent, long received, long total) {
        JSObject data = new JSObject();
        data.put("progress", percent);
        data.put("received", received);
        data.put("total", total);
        // 插件回调可能在工作线程，统一切到主线程再通知 JS
        getBridge().executeOnMainThread(() -> notifyListeners("downloadProgress", data));
    }

    /** 简单校验 APK（zip 文件头 PK），避免把错误页当成安装包 */
    private boolean isZip(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            return in.read() == 'P' && in.read() == 'K';
        } catch (IOException e) {
            return false;
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** 跳到「安装未知应用」设置页；返回是否成功跳转 */
    private boolean openInstallSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(settings);
            return true;
        } catch (Exception ignored) {
            // 少数 ROM 没有该设置页
            return false;
        }
    }

    private void installApk(Context ctx, File apk) throws Exception {
        // Android 8+ 需要用户允许「安装未知应用」（正常流程已在下载前申请，这里兜底）
        if (!canInstall()) {
            openInstallSettings();
            throw new IOException("请允许安装未知应用后重试");
        }

        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ctx.startActivity(install);
    }

    /** 清理历史安装包/半成品，避免缓存越攒越多（保留刚下载的这个） */
    private void cleanupOld(File dir, File keep) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.equals(keep)) continue;
            if (f.getName().endsWith(".apk") || f.getName().endsWith(".part")) {
                // 安装器可能还在读上一个文件时删除失败，忽略即可
                f.delete();
            }
        }
    }
}
