<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Switch - Premium Landscape Banner</title>
    <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
    
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Space Grotesk', sans-serif;
            background-color: #d1d5db;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }

        /* 4:3 Wide Landscape Billboard Layout */
        .banner-container {
            width: 1200px;
            height: 750px;
            background: #ffffff;
            box-shadow: 0 35px 60px -15px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 12px solid #111111;
        }

        /* --- BLOCK 1: THE HOOK (ROYAL BLUE) --- */
        .hook-block {
            background-color: #0046AD;
            color: #ffffff;
            text-align: center;
            height: 18%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            position: relative;
        }

        .hook-title {
            font-family: 'Unbounded', sans-serif;
            font-size: 72px;
            font-weight: 900;
            letter-spacing: -2px;
            text-transform: uppercase;
            color: #FFDD00;
            line-height: 1;
        }

        /* --- ZERO BROKERAGE STRIP --- */
        .brokerage-ribbon {
            background-color: #111111;
            color: #3CD070; 
            width: 100%;
            text-align: center;
            padding: 6px 0;
            font-size: 20px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 6px;
            border-top: 3px solid #3CD070;
        }

        /* --- BLOCK 2: VALUE & TEASERS (WHITE WIDE) --- */
        .value-block {
            background-color: #ffffff;
            color: #111111;
            padding: 0 40px;
            height: 38%; /* Restored balanced proportion with rent box removed */
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 25px;
        }

        .deal-tag {
            font-family: 'Unbounded', sans-serif;
            font-size: 38px;
            font-weight: 900;
            text-transform: uppercase;
            text-align: center;
            letter-spacing: -1px;
            color: #111111;
        }

        .deal-tag span {
            background-color: #D32F2F;
            color: #ffffff;
            padding: 0 15px;
            display: inline-block;
            transform: skewX(-6deg);
        }

        /* Dynamic Visual Teasers Layout */
        .teaser-container {
            display: flex;
            gap: 25px;
            width: 100%;
            justify-content: center;
        }

        .badge {
            background: #111111;
            color: #ffffff;
            padding: 12px 24px;
            font-size: 18px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-radius: 0px;
            clip-path: polygon(0 0, 100% 0, 95% 100%, 0% 100%);
        }

        .badge-orange {
            background: #FF6F00;
            color: #ffffff;
            clip-path: polygon(5% 0, 100% 0, 100% 100%, 0% 100%);
        }

        /* Horizontal layout for options */
        .property-types {
            font-family: 'Unbounded', sans-serif;
            font-size: 34px;
            font-weight: 900;
            color: #0046AD;
            text-transform: uppercase;
            border-top: 5px dashed #111111;
            padding-top: 20px;
            width: 90%;
            text-align: center;
        }

        /* --- BLOCK 3: ACTION & WALK-IN (BRIGHT ORANGE) --- */
        .action-block {
            background-color: #FF6F00;
            border-top: 8px solid #111111;
            color: #ffffff;
            height: 44%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 40px;
        }

        .action-left {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: flex-start;
            text-align: left;
            flex: 0.45;
        }

        .to-let-title {
            font-family: 'Unbounded', sans-serif;
            font-size: 105px;
            font-weight: 900;
            text-transform: uppercase;
            line-height: 0.85;
            color: #ffffff;
            text-shadow: 6px 6px 0px #111111;
            margin-bottom: 10px;
            white-space: nowrap;
        }

        .cta-text {
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            color: #111111;
            letter-spacing: 1px;
            background-color: #ffffff;
            padding: 4px 10px;
            white-space: nowrap;
        }

        .action-right {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: center;
            flex: 0.55;
        }

        /* Landscape Phone Display */
        .phone-number {
            font-family: 'Unbounded', sans-serif;
            font-size: 54px; 
            font-weight: 900;
            color: #D32F2F; 
            background-color: #ffffff;
            padding: 12px 25px;
            box-shadow: 10px 10px 0px #111111;
            text-decoration: none;
            letter-spacing: -1px;
            border: 5px solid #111111;
            display: block;
            white-space: nowrap;
        }

        .sub-cta {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            color: #ffffff;
            margin-top: 25px;
            letter-spacing: 3px;
            background: #111111;
            padding: 6px 15px;
            white-space: nowrap;
        }

        /* Print Layout Rules */
        @media print {
            body { background: none; padding: 0; }
            .banner-container { box-shadow: none; width: 100%; height: 100%; border: 12px solid #111; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>

    <div class="banner-container">
        
        <div class="hook-block">
            <div class="hook-title">FREE! FREE! FREE!</div>
            <div class="brokerage-ribbon">✦ Direct from Management • Zero Brokerage ✦</div>
        </div>

        <div class="value-block">
            <div class="deal-tag">
                GET <span>FREE</span> SECURE CAR PARKING!
            </div>
            
            <div class="teaser-container">
                <div class="badge">✓ Fully Furnished &amp; Equipped</div>
                <div class="badge badge-orange">👥 Co-Live &amp; Grow Together</div>
            </div>

            <div class="property-types">
                Premium 3BHK &amp; Co-Living Options
            </div>
        </div>

        <div class="action-block">
            <div class="action-left">
                <div class="to-let-title">TO-LET</div>
                <div class="cta-text">📍 CALL FOR EXACT LOCATION &amp; WALK-IN TOUR</div>
            </div>
            
            <div class="action-right">
                <a href="tel:+919741715255" class="phone-number">+91 97417 15255</a>
                <div class="sub-cta">CALL NOW | WHATSAPP FOR INSTANT VIDEO TOUR</div>
            </div>
        </div>

    </div>

</body>
</html>
