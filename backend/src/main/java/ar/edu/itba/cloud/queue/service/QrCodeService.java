package ar.edu.itba.cloud.queue.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Renders the QR code a business prints and puts on the counter.
 *
 * <p>The code encodes nothing but the public join URL of a queue, so it is safe to hand out and can be
 * regenerated at any time without invalidating anything.
 */
@Service
public class QrCodeService {

    private static final int MIN_SIZE = 128;
    private static final int MAX_SIZE = 1024;
    public static final int DEFAULT_SIZE = 512;

    public byte[] pngFor(String content, int size) {
        int pixels = Math.clamp(size, MIN_SIZE, MAX_SIZE);
        Map<EncodeHintType, Object> hints = Map.of(
                EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN, 1,
                EncodeHintType.CHARACTER_SET, "UTF-8");

        try {
            BitMatrix matrix = new QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, pixels, pixels, hints);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(matrix, "PNG", out);
            return out.toByteArray();
        } catch (WriterException ex) {
            throw new IllegalStateException("Could not encode QR code for " + content, ex);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }
}
