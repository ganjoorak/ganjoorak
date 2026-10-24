'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import PoetPlaceholder from '@/components/PoetPlaceholder';
import { isPlaceholderPoetImage } from '@/utils/poetImages';

interface PoetImageProps {
    imgUrl: string;
    alt?: string;
    poetSlug?: string;
    width?: number;
    height?: number;
}

export default function PoetImage({ imgUrl, alt, poetSlug, width = 60, height = 60 }: PoetImageProps) {
    const [imgSrc, setImgSrc] = useState<string>(imgUrl);
    const [error, setError] = useState(false);
    const isApiBackedImage = imgSrc.startsWith('/api/');

    useEffect(() => {
        setImgSrc(imgUrl);
        setError(false);
    }, [imgUrl]);

    const handleError = () => {
        if (error) {
            return;
        }

        setError(true);
    };

    // No portrait (or Ganjoor's silhouette placeholder, or a failed load): draw our own.
    if (error || isPlaceholderPoetImage(imgSrc)) {
        return (
            <PoetPlaceholder
                seed={poetSlug || alt || imgUrl}
                className="poet-image"
                style={{ width, height }}
            />
        );
    }

    return (
        <Image
            src={imgSrc}
            alt={alt || ''}
            width={width}
            height={height}
            className="poet-image"
            style={{ objectFit: 'cover' }}
            key={imgSrc}
            priority={false} // Set priority to false to reduce initial load impact
            onError={handleError}
            loading="lazy"
            unoptimized={isApiBackedImage}
            quality={75} // Reduce quality slightly to save bandwidth
        />
    );
}
