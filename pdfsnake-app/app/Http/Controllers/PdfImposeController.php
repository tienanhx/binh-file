<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PdfImposeController extends Controller
{
    public function impose(Request $request)
    {
        // 1. Validate incoming files
        $request->validate([
            'file' => 'required|file|mimes:pdf,jpeg,png',
            'steps' => 'required|file|mimes:json,txt',
        ]);

        $pdfFile = $request->file('file');
        $stepsFile = $request->file('steps');
        $apiKey = env('PDF_SNAKE_API_KEY');

        if (!$apiKey) {
            return response()->json([
                'error' => 'Chưa cấu hình PDF_SNAKE_API_KEY trong file .env'
            ], 500);
        }

        try {
            // Đọc và xử lý nội dung steps.json
            $stepsContent = file_get_contents($stepsFile->getRealPath());
            $stepsData = json_decode($stepsContent, true);

            // Xác định mảng steps từ input
            $stepsArray = null;

            if (is_array($stepsData) && isset($stepsData['steps']) && is_array($stepsData['steps'])) {
                // Input đã đúng format NewFileFormat { "steps": [...], "kind": "...", "version": [...] }
                // Nếu đã có đủ kind và version, gửi nguyên
                if (isset($stepsData['kind']) && isset($stepsData['version'])) {
                    $stepsJson = json_encode($stepsData, JSON_UNESCAPED_UNICODE);
                    Log::info('PDF Snake API - Sending full NewFileFormat: ' . $stepsJson);
                } else {
                    $stepsArray = $stepsData['steps'];
                }
            } elseif (is_array($stepsData) && isset($stepsData[0])) {
                // Input là bare array: [ { "kind": "Cards", ... } ]
                $stepsArray = $stepsData;
            } else {
                return response()->json([
                    'error' => 'File steps.json không hợp lệ - cần là mảng JSON hoặc object có field "steps".'
                ], 400);
            }

            // Nếu cần bọc vào format NewFileFormat
            if ($stepsArray !== null) {
                $newFileFormat = [
                    'steps' => $stepsArray,
                    'kind' => 'PDFSnakeValues',
                    'version' => [1, 6, 348],
                ];
                $stepsJson = json_encode($newFileFormat, JSON_UNESCAPED_UNICODE);
            }

            Log::info('PDF Snake API Request - Steps JSON: ' . $stepsJson);

            // 2. Gửi file tới PDF Snake API V2
            $response = Http::timeout(120)->withHeaders([
                'Authorization' => 'Bearer ' . $apiKey,
            ])
            ->attach('doc', file_get_contents($pdfFile->getRealPath()), $pdfFile->getClientOriginalName())
            ->attach('steps', $stepsJson, 'steps.json')
            ->post('https://api2.pdfsnake.app/api/v2/impose');

            // 3. Process the response
            if ($response->successful()) {
                $contentType = $response->header('Content-Type');

                // Kiểm tra xem response có phải PDF không (tránh nhận HTML page)
                if (strpos($contentType, 'application/pdf') === false && strpos($contentType, 'application/zip') === false) {
                    Log::warning('PDF Snake API returned non-PDF content: ' . substr($response->body(), 0, 500));
                    return response()->json([
                        'error' => 'PDF Snake API trả về nội dung không hợp lệ (không phải PDF). Content-Type: ' . $contentType
                    ], 500);
                }

                return response($response->body(), 200)
                    ->header('Content-Type', 'application/pdf')
                    ->header('Content-Disposition', 'attachment; filename="imposed_' . $pdfFile->getClientOriginalName() . '"')
                    ->header('Access-Control-Expose-Headers', 'Content-Disposition');
            }

            // Log lỗi chi tiết
            Log::error('PDF Snake API Error: Status=' . $response->status() . ' Body=' . substr($response->body(), 0, 1000));

            return response()->json([
                'error' => 'Lỗi từ PDF Snake API: ' . $response->body()
            ], $response->status());

        } catch (\Exception $e) {
            Log::error('PDF Imposition Error: ' . $e->getMessage());
            return response()->json([
                'error' => 'Có lỗi xảy ra trong quá trình xử lý: ' . $e->getMessage()
            ], 500);
        }
    }
}
